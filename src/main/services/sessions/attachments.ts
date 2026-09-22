/**
 * Context attachments: files the user pins to a message. `repo_file` points
 * at a file inside the opened folder; `backend_source` points at a source
 * uploaded to the repository (stored under the app's data directory). Both
 * are validated at acceptance, persisted alongside the message, echoed in
 * SSE `chat` events and history, and rendered into the prompt as a private
 * context block the model reads with its file tools.
 */

import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { ChatAttachmentSelection, ChatContextAttachmentBody, ChatContextAttachmentPayload } from '@shared/api-types';
import { HttpError } from '../../server/errors';
import type { AppPaths } from '../../paths';
import type { Registry } from '../../store/registry';
import type { RepositoryRow } from '../../store/rows';

export const MAX_MESSAGE_CONTEXT_ATTACHMENTS = 20;
const SOURCE_ARTIFACT_KINDS = new Set(['original', 'latex', 'ocr']);
// Paths the web backend never serves as attachments (generated / VCS state).
const EXCLUDED_SEGMENTS = new Set(['.git', '.lake', 'node_modules']);

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Pydantic-equivalent validation of the `selection` object (422 on failure). */
export function validateSelection(raw: unknown): ChatAttachmentSelection {
  if (raw === undefined || raw === null) return { kind: 'entire_file' };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(422, 'selection must be an object', 'validation_error');
  const selection = raw as Record<string, unknown>;
  const keys = Object.keys(selection).filter((key) => key !== 'kind').sort();
  switch (selection.kind) {
    case 'entire_file':
      if (keys.length > 0) throw new HttpError(422, 'entire_file selection takes no range', 'validation_error');
      return { kind: 'entire_file' };
    case 'line_range': {
      if (keys.join(',') !== 'end_line,start_line') throw new HttpError(422, 'line_range selection needs start_line and end_line', 'validation_error');
      const { start_line, end_line } = selection;
      if (!isPositiveInt(start_line) || !isPositiveInt(end_line) || end_line < start_line) {
        throw new HttpError(422, 'line_range selection is out of range', 'validation_error');
      }
      return { kind: 'line_range', start_line, end_line };
    }
    case 'page_range': {
      if (keys.join(',') !== 'end_page,start_page') throw new HttpError(422, 'page_range selection needs start_page and end_page', 'validation_error');
      const { start_page, end_page } = selection;
      if (!isPositiveInt(start_page) || !isPositiveInt(end_page) || end_page < start_page) {
        throw new HttpError(422, 'page_range selection is out of range', 'validation_error');
      }
      return { kind: 'page_range', start_page, end_page };
    }
    default:
      throw new HttpError(422, 'selection.kind must be entire_file, line_range or page_range', 'validation_error');
  }
}

/** Normalise a repo-relative path; null when it escapes or is malformed. */
export function normalizeRepoPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/');
  if (!trimmed || isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed)) return null;
  const normalized = normalize(trimmed).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return null;
  return normalized;
}

function absoluteInside(root: string, repoPath: string): string | null {
  const absolute = resolve(root, repoPath);
  const rel = relative(resolve(root), absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}

export interface AttachmentContext {
  registry: Registry;
  paths: AppPaths;
  repository: RepositoryRow;
}

/**
 * Validate the request-side attachments and turn them into persisted
 * payloads, raising the web backend's exact status codes.
 */
export function resolveContextAttachments(
  raw: unknown,
  ctx: AttachmentContext,
): ChatContextAttachmentPayload[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(422, 'context_attachments must be a list', 'validation_error');
  if (raw.length > MAX_MESSAGE_CONTEXT_ATTACHMENTS) {
    throw new HttpError(400, `Too many context attachments. Maximum is ${MAX_MESSAGE_CONTEXT_ATTACHMENTS} per message.`, 'http_400');
  }
  const createdAt = new Date().toISOString();
  return raw.map((entry) => {
    const body = (entry ?? {}) as ChatContextAttachmentBody;
    const selection = validateSelection(body.selection);
    if (body.attachment_kind === 'repo_file') {
      if (body.source_id || body.artifact_kind) throw new HttpError(400, 'repo_file attachments cannot reference a source.', 'http_400');
      if (typeof body.repo_path !== 'string' || !body.repo_path.trim()) throw new HttpError(400, 'repo_path is required for repo_file attachments.', 'http_400');
      const repoPath = normalizeRepoPath(body.repo_path);
      if (!repoPath) throw new HttpError(400, 'repo_path is invalid.', 'http_400');
      const absolute = absoluteInside(ctx.repository.path, repoPath);
      if (!absolute) throw new HttpError(404, 'File not found', 'http_404');
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        throw new HttpError(404, 'File not found', 'http_404');
      }
      if (!stat.isFile()) throw new HttpError(404, 'File not found', 'http_404');
      return {
        id: randomUUID(),
        attachment_kind: 'repo_file',
        source_id: null,
        artifact_kind: null,
        repo_path: repoPath,
        display_name: repoPath,
        selection,
        created_at: createdAt,
      };
    }
    if (body.attachment_kind === 'backend_source') {
      if (typeof body.source_id !== 'string' || !body.source_id) throw new HttpError(400, 'source_id is required for backend_source attachments.', 'http_400');
      if (body.repo_path) throw new HttpError(400, 'backend_source attachments cannot carry a repo_path.', 'http_400');
      const source = ctx.registry.getSource(ctx.repository.id, body.source_id);
      if (!source || source.status === 'archived' || source.status === 'deleted' || source.status === 'deleting') {
        throw new HttpError(404, 'Source not found', 'http_404');
      }
      const artifactKind = body.artifact_kind ?? 'original';
      if (!SOURCE_ARTIFACT_KINDS.has(artifactKind)) throw new HttpError(400, 'Unsupported source artifact kind.', 'http_400');
      if (!source.artifacts[artifactKind as keyof typeof source.artifacts]) {
        throw new HttpError(400, 'Requested source artifact is not available.', 'http_400');
      }
      return {
        id: randomUUID(),
        attachment_kind: 'backend_source',
        source_id: source.id,
        artifact_kind: artifactKind,
        repo_path: null,
        display_name: source.display_name,
        selection,
        created_at: createdAt,
      };
    }
    throw new HttpError(422, 'attachment_kind must be backend_source or repo_file', 'validation_error');
  });
}

function selectionSummary(selection: ChatAttachmentSelection | undefined): string | null {
  if (!selection || typeof selection !== 'object') return null;
  if (selection.kind === 'line_range') return `lines ${selection.start_line}-${selection.end_line}`;
  if (selection.kind === 'page_range') return `pages ${selection.start_page}-${selection.end_page}`;
  return null;
}

export interface AttachmentPromptContext {
  paths: AppPaths;
  registry: Registry;
  repository: RepositoryRow;
}

/**
 * Where the model should read an attachment from. Repository files are read
 * relative to the working directory; uploaded sources live outside the
 * repository, so their absolute artifact path is spelled out.
 */
function attachmentReadTool(attachment: ChatContextAttachmentPayload, ctx: AttachmentPromptContext | null): string {
  if (attachment.attachment_kind !== 'backend_source') return 'Read';
  if (!ctx || !attachment.source_id) return 'Read';
  const source = ctx.registry.getSource(ctx.repository.id, attachment.source_id);
  const kind = (attachment.artifact_kind ?? 'original') as keyof NonNullable<typeof source>['artifacts'];
  const fileName = source?.artifacts[kind];
  if (!fileName) return 'Read';
  return `Read ${join(ctx.paths.sourcesDir(ctx.repository.id), attachment.source_id, fileName)}`;
}

/** Render attachment metadata into the private prompt block (verbatim from the web). */
export function buildAttachmentContextBlock(
  attachments: readonly ChatContextAttachmentPayload[],
  ctx: AttachmentPromptContext | null = null,
): string {
  if (attachments.length === 0) return '';
  const lines = [
    'The user attached the following files. Read the parts relevant to their request.',
    '',
    'Attached files:',
  ];
  attachments.forEach((attachment, index) => {
    const stableId =
      attachment.attachment_kind === 'backend_source'
        ? `source:${attachment.source_id}`
        : `repo_path:${attachment.repo_path}`;
    lines.push(
      `- File ${index + 1}:`,
      `  - Name: ${attachment.display_name ?? ''}`,
      `  - Source ID: ${stableId}`,
      `  - Read with: ${attachmentReadTool(attachment, ctx)}`,
    );
    const summary = selectionSummary(attachment.selection);
    if (summary) lines.push(`  - Relevant range: ${summary}`);
  });
  lines.push(
    '',
    'Instructions:',
    '- Treat phrases such as "this file" or "the source" as references to the attached files when the user\'s meaning is otherwise ambiguous.',
    '- Do not expose source IDs, backend object keys, or storage URLs to the user.',
    '- Do not commit attached backend sources or copy them into the repository. Use them only as private context.',
    '- When citing an attached file, use its display name and line, page, or section reference when available.',
  );
  return lines.join('\n');
}

/** Return the user message followed by its attachment context, if any. */
export function messageWithContext(
  message: string,
  attachments: readonly ChatContextAttachmentPayload[] | undefined,
  ctx: AttachmentPromptContext | null = null,
): string {
  const block = buildAttachmentContextBlock(attachments ?? [], ctx);
  return block ? `${message}\n\n${block}` : message;
}
