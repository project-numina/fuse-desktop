/**
 * Workspace creation (``POST .../blueprints/create-workspace``): validate
 * the multipart fields, store an uploaded source, and insert the
 * BlueprintRow. The workspace works in the folder on its current branch;
 * no branch or file is created here (the starter blueprint comes later).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateWorkspaceFields, CreateWorkspaceResponse } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../store/registry';
import type { BlueprintRow, RepositoryRow } from '../../store/rows';
import { currentBranch, isGitRepository, isSafeBranchName } from '../git';
import { MAX_SOURCE_UPLOAD_BYTES, PDF_UNREADABLE_DETAIL, pdfPageCount, SOURCE_UPLOAD_TOO_LARGE_DETAIL } from '../sources';
import { sourceService } from './contracts';
import { defaultBlueprintFileForProject, generateBlueprintId, safeBlueprintFilePath, validateProjectSubdir } from './ids';

export const MAX_LATEX_SOURCE_CHARACTERS = 50_000;

export interface UploadFile {
  name: string;
  bytes: Uint8Array;
}

export interface ParsedSourceUpload {
  sourceLatex: string;
  sourcePdfBytes: Uint8Array | null;
}

function validateLatexLength(text: string): void {
  if (text.length > MAX_LATEX_SOURCE_CHARACTERS) {
    throw new Error(
      `LaTeX source is too large (${text.length.toLocaleString('en-US')} characters). Maximum is ${MAX_LATEX_SOURCE_CHARACTERS.toLocaleString('en-US')} characters.`,
    );
  }
}

export const PDF_PAGE_RANGE_UNSUPPORTED_DETAIL = 'Selecting a page range is not supported on desktop; upload the whole PDF (or the pages you need as a separate file).';

/**
 * ``(source_latex, source_pdf_bytes)`` from a file upload or the pasted
 * text field. Throws ``Error`` with the user-facing message on invalid input.
 * A PDF page range is validated against the document, but the app ships no
 * PDF writer to slice with, so a range narrower than the whole document is
 * refused rather than silently ignored.
 */
export async function parseSourceUpload(
  file: UploadFile | null,
  latexContent: string,
  pageStart: number | null = null,
  pageEnd: number | null = null,
): Promise<ParsedSourceUpload> {
  if (file && file.name) {
    if (file.name.endsWith('.pdf')) {
      // Enforce the raw-upload cap before any slicing so a short page range
      // cannot sneak an oversized original past the guard.
      if (file.bytes.length > MAX_SOURCE_UPLOAD_BYTES) throw new Error(SOURCE_UPLOAD_TOO_LARGE_DETAIL);
      let total: number;
      try {
        total = await pdfPageCount(file.bytes);
      } catch {
        throw new Error(PDF_UNREADABLE_DETAIL);
      }
      if (pageStart !== null && pageEnd !== null) {
        if (pageStart < 1 || pageEnd > total || pageStart > pageEnd) {
          throw new Error(`Invalid page range ${pageStart}–${pageEnd} for a ${total}-page PDF.`);
        }
        if (pageStart !== 1 || pageEnd !== total) throw new Error(PDF_PAGE_RANGE_UNSUPPORTED_DETAIL);
      }
      return { sourceLatex: '', sourcePdfBytes: file.bytes };
    }
    if (file.bytes.length > MAX_SOURCE_UPLOAD_BYTES) throw new Error(SOURCE_UPLOAD_TOO_LARGE_DETAIL);
    if (file.name.endsWith('.tex')) {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
      } catch {
        throw new Error('Uploaded .tex file is not valid UTF-8.');
      }
      validateLatexLength(text);
      return { sourceLatex: text, sourcePdfBytes: null };
    }
    throw new Error('Unsupported file type. Please upload a .tex or .pdf file.');
  }
  if (latexContent) {
    validateLatexLength(latexContent);
    return { sourceLatex: latexContent, sourcePdfBytes: null };
  }
  return { sourceLatex: '', sourcePdfBytes: null };
}

function parsePage(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const page = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(page)) throw new HttpError(422, 'Page numbers must be integers.', 'http_422');
  return page;
}

/**
 * Create a workspace record for ``repository`` from the creation form.
 * Errors: 400 missing title / bad source, 422 bad subdir or path, 409
 * duplicate id or source name.
 */
export async function createWorkspace(
  ctx: AppContext,
  repository: RepositoryRow,
  fields: CreateWorkspaceFields,
  file?: UploadFile | null,
): Promise<CreateWorkspaceResponse> {
  const title = (fields.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Title is required', 'http_400');
  const projectSubdir = validateProjectSubdir(fields.project_subdir); // 422 on invalid input
  let upload: ParsedSourceUpload;
  try {
    upload = await parseSourceUpload(file && file.name ? file : null, fields.latex_content ?? '', parsePage(fields.page_start), parsePage(fields.page_end));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, (error as Error).message, 'http_400');
  }
  const blueprintId = generateBlueprintId(title);
  const existingPath = (fields.existing_blueprint_path ?? '').trim();
  if (existingPath) {
    if (safeBlueprintFilePath(existingPath) === null) {
      throw new HttpError(422, 'Existing blueprint path must be a repo-relative .tex file.', 'http_422');
    }
    if (upload.sourceLatex || upload.sourcePdfBytes) {
      throw new HttpError(422, 'Existing blueprint import cannot be combined with a source upload.', 'http_422');
    }
  }
  const baseBranch = (fields.base_branch ?? '').trim().replace(/^refs\/heads\//, '');
  if (baseBranch && !isSafeBranchName(baseBranch)) throw new HttpError(422, 'Invalid base branch.', 'http_422');
  // The workspace runs on whatever is checked out; a different base branch
  // would be silently ignored, so refuse it instead.
  if (baseBranch && (await isGitRepository(repository.path))) {
    const branch = await currentBranch(repository.path);
    if (branch && branch !== baseBranch) {
      throw new HttpError(409, `Workspaces run on the checked-out branch (${branch}); check out ${baseBranch} in the folder first.`, 'http_409');
    }
  }
  if (ctx.registry.getBlueprint(repository.id, blueprintId)) {
    throw new HttpError(409, 'A blueprint with this title already exists.', 'http_409');
  }

  // Adopt the conventional entrypoint when the project already ships one
  // (the web does this in the post-create metadata refresh).
  let blueprintFile: string | null = existingPath || null;
  if (blueprintFile === null) {
    const conventional = defaultBlueprintFileForProject(projectSubdir);
    if (existsSync(join(repository.path, ...conventional.split('/')))) blueprintFile = conventional;
  }

  let sourceId: string | null = null;
  let sourceType: BlueprintRow['source_type'] = 'none';
  if (upload.sourcePdfBytes || upload.sourceLatex) {
    const sources = sourceService(ctx);
    const isPdf = upload.sourcePdfBytes !== null;
    const created = await sources.create({
      repository,
      filename: isPdf ? `${blueprintId}.pdf` : `${blueprintId}.tex`,
      displayName: file?.name || `${blueprintId}-source`,
      bytes: isPdf ? (upload.sourcePdfBytes as Uint8Array) : new TextEncoder().encode(upload.sourceLatex),
      scopedBlueprintId: blueprintId,
      metadata: { blueprint_id: blueprintId, blueprint_title: title, created_from: 'blueprint_create' },
    });
    sourceId = created.id;
    sourceType = isPdf ? 'pdf' : 'latex';
  }

  const now = new Date().toISOString();
  const row: BlueprintRow = {
    id: blueprintId,
    repository_id: repository.id,
    title,
    description: '',
    area: '',
    blueprint_file: blueprintFile,
    project_subdir: projectSubdir,
    source_type: sourceType,
    source_id: sourceId,
    pr_mode: 'off',
    auto_commit: false,
    orchestrator_child_concurrency: 1,
    agent: { ...ctx.settings.get().agentDefaults },
    created_at: now,
    updated_at: now,
  };
  try {
    ctx.registry.insertBlueprint(row);
  } catch (error) {
    // Compensate: the uploaded source must not outlive a failed create.
    if (sourceId) await sourceService(ctx).delete(repository, sourceId, blueprintId).catch(() => undefined);
    if (error instanceof HttpError && error.status === 409) {
      throw new HttpError(409, 'A blueprint with this title already exists.', 'http_409');
    }
    console.error('Blueprint creation failed:', error);
    throw new HttpError(500, 'Blueprint creation failed.', 'http_500');
  }
  return { blueprint_id: blueprintId, message: `Blueprint '${title}' created successfully` };
}
