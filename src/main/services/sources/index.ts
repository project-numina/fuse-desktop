/**
 * Repository sources: uploaded or imported reference material (.tex, .md,
 * .pdf) stored under `<userData>/data/repositories/<id>/sources/<uuid>/`
 * with a registry row each. Keeps the web's naming, size, visibility and
 * status rules; the single local user replaces uploader ownership, and a
 * blueprint id stands in for the workspace a source is scoped to.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { RepositorySourceResponse, SourceArtifactKind } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../store/registry';
import type { RepositoryRow, RepositorySourceRow } from '../../store/rows';
import type { OpenProject } from '../types';
import {
  BLUEPRINT_ID_KEY,
  countTextLines,
  metadataBlueprintName,
  OCR_PAGE_STARTS_KEY,
  PROJECT_SCOPED_KEY,
  REPOSITORY_CONTENT_SHA256_KEY,
  REPOSITORY_PATH_KEY,
  SCOPED_BLUEPRINT_ID_KEY,
  sourceScopedBlueprint,
  TEXT_LINE_COUNT_KEY,
} from './metadata';
import { prepareRepositoryImport } from './repository-import';
import {
  activeSourceRows,
  archiveBlueprintSourceRows,
  normalizeSourceContext,
  requireAvailableSourceName,
  requireVisibleSourceRow,
  sourceResponse,
  validateSourceDisplayName,
  visibleSourceRows,
} from './rows';
import {
  readSourceArtifactText,
  removeSourceArtifact,
  removeSourceDirectory,
  sourceArtifactPath,
  sourceDirectory,
  writeAtomic,
} from './storage';
import {
  hasSupportedExtension,
  MAX_SOURCE_UPLOAD_BYTES,
  SOURCE_UPLOAD_TOO_LARGE_DETAIL,
  validatedSourcePayload,
  type ValidatedPayload,
} from './validation';

export { pdfPageCount, validatePdfUpload, PDF_UNREADABLE_DETAIL } from './pdf';
export {
  BLUEPRINT_ID_KEY,
  countTextLines,
  deriveOcrPhase,
  isActiveSource,
  isSourceVisibleInContext,
  OCR_PAGE_STARTS_KEY,
  PROJECT_SCOPED_KEY,
  publicSourceMetadata,
  REPOSITORY_CONTENT_SHA256_KEY,
  REPOSITORY_PATH_KEY,
  SCOPED_BLUEPRINT_ID_KEY,
  sourceScopedBlueprint,
  TEXT_LINE_COUNT_KEY,
} from './metadata';
export {
  EXCLUDED_DIRECTORY_NAMES,
  EXCLUDED_ROOT_DIRECTORY_NAMES,
  normalizeRepositoryFilePath,
  repositoryFilePathIsExcluded,
} from './repository-import';
export { readBoundedRepositoryFile } from './storage';
export { MAX_SOURCE_NAME_CHARACTERS, MAX_SOURCE_UPLOAD_BYTES, SOURCE_UPLOAD_TOO_LARGE_DETAIL } from './validation';

const ORIGINAL_EXTENSION_BY_TYPE: Record<string, string> = { pdf: 'pdf', latex: 'tex', markdown: 'md' };

export interface SourceUploadFile {
  name: string;
  bytes: Uint8Array;
}

export interface UploadSourceOptions {
  displayName?: string | null;
  projectScoped?: boolean;
  blueprintId?: string | null;
}

export interface CreateSourceInput {
  repository: RepositoryRow;
  /** Determines the source type by extension (validated). */
  filename: string;
  /** Blank/null → the filename. */
  displayName: string | null;
  bytes: Uint8Array;
  /** Workspace-only scope: the blueprint the source is private to. */
  scopedBlueprintId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CanonicalSourceView {
  source_content: string;
  source_type: string;
  source_pdf_path: string;
  source_file_url: string;
  source_pdf_url: string;
}

export class SourceService {
  constructor(private readonly ctx: AppContext) {}

  // ── Storage ──────────────────────────────────────────────────────────────

  sourceDir(row: Pick<RepositorySourceRow, 'repository_id' | 'id'>): string {
    return sourceDirectory(this.ctx, row);
  }

  /** Absolute path of an artifact file, or null when the source has none of that kind. */
  artifactPath(row: RepositorySourceRow, kind: SourceArtifactKind): string | null {
    return sourceArtifactPath(this.ctx, row, kind);
  }

  async readArtifactText(row: RepositorySourceRow, kind: SourceArtifactKind): Promise<string | null> {
    return readSourceArtifactText(this.ctx, row, kind);
  }

  // ── Rows ─────────────────────────────────────────────────────────────────

  toResponse(repository: RepositoryRow, row: RepositorySourceRow): RepositorySourceResponse {
    return sourceResponse(repository, row);
  }

  private activeRows(repositoryId: number): RepositorySourceRow[] {
    return activeSourceRows(this.ctx, repositoryId);
  }

  private normalizeContext(blueprintId: string | null | undefined): string | null {
    return normalizeSourceContext(blueprintId);
  }

  /** Sources visible in a blueprint context (or repository-wide only), newest first. */
  list(repository: RepositoryRow, blueprintId?: string | null): RepositorySourceResponse[] {
    return visibleSourceRows(this.ctx, repository.id, blueprintId).map((row) => this.toResponse(repository, row));
  }

  /** The row when it is active and visible in the context; 404 otherwise. */
  requireVisibleRow(repository: RepositoryRow, sourceId: string, blueprintId?: string | null): RepositorySourceRow {
    return requireVisibleSourceRow(this.ctx, repository, sourceId, blueprintId);
  }

  get(repository: RepositoryRow, sourceId: string, blueprintId?: string | null): RepositorySourceResponse {
    return this.toResponse(repository, this.requireVisibleRow(repository, sourceId, blueprintId));
  }

  /** Reject a display name already used by an active source in the visibility scope. */
  private requireAvailableName(repositoryId: number, name: string, scopedBlueprintId: string | null, ignoreId?: string): void {
    requireAvailableSourceName(this.activeRows(repositoryId), name, scopedBlueprintId, ignoreId);
  }

  private validateDisplayName(displayName: string | null | undefined, filename: string): string {
    return validateSourceDisplayName(displayName, filename);
  }

  // ── Create / upload / import ─────────────────────────────────────────────

  /** Validate bytes and create the matching managed source (artifact + row). */
  async create(input: CreateSourceInput): Promise<RepositorySourceResponse> {
    const scope = this.normalizeContext(input.scopedBlueprintId);
    const displayName = this.validateDisplayName(input.displayName, input.filename);
    this.requireAvailableName(input.repository.id, displayName, scope);
    const payload = await validatedSourcePayload(input.filename, input.bytes);
    const id = randomUUID();
    const extension = ORIGINAL_EXTENSION_BY_TYPE[payload.type];
    const filename = `original.${extension}`;
    const dir = join(this.ctx.paths.sourcesDir(input.repository.id), id);
    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (scope !== null && metadataBlueprintName(metadata, BLUEPRINT_ID_KEY) === null) {
      metadata[PROJECT_SCOPED_KEY] = true;
      metadata[SCOPED_BLUEPRINT_ID_KEY] = scope;
    }
    const artifacts: RepositorySourceRow['artifacts'] = { original: filename };
    if (payload.type === 'latex') artifacts.latex = filename;
    if (payload.type !== 'pdf') metadata[TEXT_LINE_COUNT_KEY] = countTextLines(payload.text);
    try {
      await writeAtomic(join(dir, filename), payload.type === 'pdf' ? payload.bytes : payload.text);
      const now = new Date().toISOString();
      const row: RepositorySourceRow = {
        id,
        repository_id: input.repository.id,
        display_name: displayName,
        source_type: payload.type,
        status: 'ready',
        artifacts,
        metadata,
        created_at: now,
        updated_at: now,
      };
      this.ctx.registry.insertSource(row);
      return this.toResponse(input.repository, row);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** ``POST /sources`` (multipart ``file``, ``display_name?``, ``project_scoped?``, ``blueprint_id?``). */
  async upload(repository: RepositoryRow, file: SourceUploadFile, options: UploadSourceOptions = {}): Promise<RepositorySourceResponse> {
    let scope: string | null = null;
    if (options.projectScoped) {
      scope = this.normalizeContext(options.blueprintId);
      if (scope === null) throw new HttpError(400, 'A workspace-only source requires a blueprint id.', 'http_400');
      if (!this.ctx.registry.getBlueprint(repository.id, scope)) throw new HttpError(404, 'Blueprint not found', 'http_404');
    }
    if (!hasSupportedExtension(file.name)) {
      throw new HttpError(400, 'Unsupported file type. Please upload a .tex, .md, .markdown, or .pdf file.', 'http_400');
    }
    if (file.bytes.length > MAX_SOURCE_UPLOAD_BYTES) throw new HttpError(400, SOURCE_UPLOAD_TOO_LARGE_DETAIL, 'http_400');
    return this.create({
      repository,
      filename: file.name,
      displayName: options.displayName ?? null,
      bytes: file.bytes,
      scopedBlueprintId: scope,
    });
  }

  /** Replace an imported source's stored snapshot without changing its id. */
  private async replaceContent(row: RepositorySourceRow, payload: ValidatedPayload, contentHash: string): Promise<RepositorySourceRow> {
    const metadata: Record<string, unknown> = { ...row.metadata, [REPOSITORY_CONTENT_SHA256_KEY]: contentHash };
    const artifacts: RepositorySourceRow['artifacts'] = { ...row.artifacts };
    const originalPath = this.artifactPath(row, 'original');
    if (!originalPath) throw new HttpError(409, 'The repository file type no longer matches its source.', 'http_409');
    if (payload.type === 'pdf') {
      await writeAtomic(originalPath, payload.bytes);
      // OCR is derived from the prior PDF snapshot and must not survive a refresh.
      await removeSourceArtifact(this.ctx, row, 'ocr');
      delete artifacts.ocr;
      delete metadata[OCR_PAGE_STARTS_KEY];
    } else {
      const target = payload.type === 'latex' ? (this.artifactPath(row, 'latex') ?? originalPath) : originalPath;
      await writeAtomic(target, payload.text);
      metadata[TEXT_LINE_COUNT_KEY] = countTextLines(payload.text);
    }
    return this.ctx.registry.updateSource(row.repository_id, row.id, { artifacts, metadata, status: 'ready' });
  }

  /** ``POST /sources/import``: copy one repository file into managed Sources. */
  async importRepositoryFile(project: OpenProject, rawRepoPath: string): Promise<RepositorySourceResponse> {
    const { repository, blueprint } = project;
    const { repoPath, bytes, payload, contentHash } = await prepareRepositoryImport(project, rawRepoPath);
    for (const row of this.activeRows(repository.id)) {
      if (row.metadata[REPOSITORY_PATH_KEY] !== repoPath) continue;
      const scope = sourceScopedBlueprint(row);
      if (scope !== null && scope !== blueprint.id) continue;
      let current = row;
      if (scope === null) {
        // A legacy unscoped import is claimed by the importing workspace.
        current = this.ctx.registry.updateSource(row.repository_id, row.id, {
          metadata: { ...row.metadata, [PROJECT_SCOPED_KEY]: true, [SCOPED_BLUEPRINT_ID_KEY]: blueprint.id },
        });
      }
      if (current.metadata[REPOSITORY_CONTENT_SHA256_KEY] === contentHash) return this.toResponse(repository, current);
      if (current.source_type !== payload.type) {
        throw new HttpError(409, 'The repository file type no longer matches its source.', 'http_409');
      }
      return this.toResponse(repository, await this.replaceContent(current, payload, contentHash));
    }
    return this.create({
      repository,
      filename: repoPath,
      displayName: repoPath,
      bytes,
      scopedBlueprintId: blueprint.id,
      metadata: {
        [PROJECT_SCOPED_KEY]: true,
        [SCOPED_BLUEPRINT_ID_KEY]: blueprint.id,
        [REPOSITORY_PATH_KEY]: repoPath,
        [REPOSITORY_CONTENT_SHA256_KEY]: contentHash,
      },
    });
  }

  // ── Delete / archive ─────────────────────────────────────────────────────

  /** ``DELETE /sources/:id``: remove artifacts, keep a ``deleted`` tombstone row. */
  async delete(repository: RepositoryRow, sourceId: string, blueprintId?: string | null): Promise<void> {
    const context = this.normalizeContext(blueprintId);
    const row = this.requireVisibleRow(repository, sourceId, context);
    if (context !== null && !this.ctx.registry.getBlueprint(repository.id, context)) {
      throw new HttpError(404, 'Blueprint not found', 'http_404');
    }
    await removeSourceDirectory(this.ctx, row);
    this.ctx.registry.updateSource(repository.id, row.id, { artifacts: {}, status: 'deleted' });
  }

  /** Archive sources created for or scoped to a blueprint; returns the count. */
  archiveBlueprintSources(repositoryId: number, blueprintName: string): number {
    return archiveBlueprintSourceRows(this.ctx, repositoryId, blueprintName);
  }

  // ── Serving ──────────────────────────────────────────────────────────────

  /** Resolve an artifact for ``GET /sources/:id/artifacts/:kind``. */
  artifact(repository: RepositoryRow, sourceId: string, kind: string, blueprintId?: string | null): { path: string; mediaType: string } {
    const row = this.requireVisibleRow(repository, sourceId, blueprintId);
    if (kind !== 'original' && kind !== 'latex' && kind !== 'ocr') throw new HttpError(404, 'Artifact not found', 'http_404');
    const path = this.artifactPath(row, kind);
    if (!path || !existsSync(path)) throw new HttpError(404, 'Artifact not found', 'http_404');
    // Media type follows the source type: only a PDF's original is binary.
    const mediaType = row.source_type === 'pdf' && kind === 'original' ? 'application/pdf' : 'text/plain';
    return { path, mediaType };
  }

  /** Resolve the PDF bytes for ``GET /sources/:id/pdf-preview``. */
  pdfPreview(repository: RepositoryRow, sourceId: string, blueprintId?: string | null): { path: string } {
    const row = this.requireVisibleRow(repository, sourceId, blueprintId);
    const path = row.source_type === 'pdf' ? this.artifactPath(row, 'original') : null;
    if (!path || !existsSync(path)) throw new HttpError(404, 'PDF preview not found', 'http_404');
    return { path };
  }

  /** The blueprint's canonical creation-time source, as the detail payload shows it. */
  async canonicalSourceView(repository: RepositoryRow, blueprintName: string): Promise<CanonicalSourceView | null> {
    const row = this.activeRows(repository.id).find((candidate) => metadataBlueprintName(candidate.metadata ?? {}, BLUEPRINT_ID_KEY) === blueprintName);
    if (!row) return null;
    const encode = (value: string): string => encodeURIComponent(value);
    const base = `/api/repositories/${encode(repository.owner)}/${encode(repository.name)}/sources/${encode(row.id)}`;
    const query = `?blueprint_id=${encode(blueprintName)}`;
    const textKind: SourceArtifactKind | null = row.artifacts.ocr ? 'ocr' : row.artifacts.latex ? 'latex' : null;
    const content: string = textKind ? ((await this.readArtifactText(row, textKind)) ?? '') : '';
    return {
      source_content: content,
      source_type: row.source_type,
      source_pdf_path: '',
      source_file_url: textKind ? `${base}/artifacts/${textKind}${query}` : '',
      source_pdf_url: row.source_type === 'pdf' && row.artifacts.original ? `${base}/pdf-preview${query}` : '',
    };
  }
}

/** Register the singleton under ``ctx.services.sources``. */
export function registerSourceService(ctx: AppContext): SourceService {
  const existing = ctx.services.sources as SourceService | undefined;
  if (existing) return existing;
  const service = new SourceService(ctx);
  ctx.services.sources = service;
  return service;
}
