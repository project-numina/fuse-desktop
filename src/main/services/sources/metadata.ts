import type { RepositorySourceRow } from '../../store/rows';

export const BLUEPRINT_ID_KEY = 'blueprint_id';
export const PROJECT_SCOPED_KEY = 'project_scoped';
export const SCOPED_BLUEPRINT_ID_KEY = 'scoped_blueprint_id';
export const REPOSITORY_PATH_KEY = 'repository_path';
export const REPOSITORY_CONTENT_SHA256_KEY = 'repository_content_sha256';
export const OCR_PAGE_STARTS_KEY = 'ocr_page_starts';
export const TEXT_LINE_COUNT_KEY = '_text_line_count';

const ACTIVE_STATUSES_EXCLUDED = new Set(['archived', 'deleted']);
const LINE_BREAKS = ['\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', ' ', ' '];

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + needle.length)) count += 1;
  return count;
}

/** Match Python ``str.splitlines`` line counts without allocating every line. */
export function countTextLines(content: string): number {
  if (!content) return 0;
  let breaks = 0;
  for (const character of LINE_BREAKS) breaks += countOccurrences(content, character);
  breaks -= countOccurrences(content, '\r\n');
  const endsWithBreak = LINE_BREAKS.some((character) => content.endsWith(character));
  return breaks + (endsWithBreak ? 0 : 1);
}

export function metadataBlueprintName(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

/** The blueprint a scoped source belongs to, or null for repository-wide. */
export function sourceScopedBlueprint(row: Pick<RepositorySourceRow, 'metadata'>): string | null {
  const metadata = row.metadata ?? {};
  const canonical = metadataBlueprintName(metadata, BLUEPRINT_ID_KEY);
  if (canonical !== null) return canonical;
  if (!metadata[PROJECT_SCOPED_KEY]) return null;
  return metadataBlueprintName(metadata, SCOPED_BLUEPRINT_ID_KEY);
}

/** A workspace-only source is visible in its blueprint only; others everywhere. */
export function isSourceVisibleInContext(row: Pick<RepositorySourceRow, 'metadata'>, blueprintName: string | null): boolean {
  const scoped = sourceScopedBlueprint(row);
  return scoped === null || scoped === blueprintName;
}

/** Metadata safe for API clients: internal caches stripped, scope normalised. */
export function publicSourceMetadata(row: Pick<RepositorySourceRow, 'metadata'>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    if (key !== TEXT_LINE_COUNT_KEY) metadata[key] = value;
  }
  const canonical = metadataBlueprintName(metadata, BLUEPRINT_ID_KEY);
  if (canonical !== null) {
    metadata[PROJECT_SCOPED_KEY] = true;
    metadata[SCOPED_BLUEPRINT_ID_KEY] = canonical;
  }
  return metadata;
}

export function isActiveSource(row: Pick<RepositorySourceRow, 'status'>): boolean {
  return !ACTIVE_STATUSES_EXCLUDED.has(row.status);
}

/** ``"" | "scanning" | "failed" | "complete"`` for the Source panel's OCR dot. */
export function deriveOcrPhase(sourceType: string, sourceContent: string, livePhase: string | null): '' | 'scanning' | 'failed' | 'complete' {
  if (livePhase === 'scanning' || livePhase === 'failed') return livePhase;
  if (sourceType !== 'pdf') return '';
  if (!sourceContent || sourceContent.startsWith('% OCR pending')) return '';
  return 'complete';
}
