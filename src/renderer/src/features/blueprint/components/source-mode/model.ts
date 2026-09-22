import type { RepositorySource } from '@/lib/api';
import type { ChatContextAttachment } from '@/features/chat/state/types';

export interface SourceModeBlueprint {
  id?: string;
  source_type?: string;
  source_content?: string;
  source_file_url?: string;
  source_pdf_url?: string;
}

export interface SourceModeProps {
  /** The current blueprint (legacy inline source fields live here). */
  blueprint: SourceModeBlueprint;
  /** Repository-level sources visible in this blueprint context. */
  repositorySources?: RepositorySource[];
  /** Currently selected source id. */
  selectedSourceId?: string;
  /** Repository owner. */
  owner?: string;
  /** Repository name. */
  repo?: string;
  /** Blueprint id. */
  blueprintId?: string;
  /** Public shares cannot fetch protected artifacts. */
  publicShare?: boolean;
  /** Adds a selected source range to the chat composer. */
  onAttachContext?: (attachment: ChatContextAttachment) => void;
}

export interface SourceDisplayModel {
  selectedRepositorySource: RepositorySource | null;
  sourceType: string;
  hasPdf: boolean;
  hasPdfPreview: boolean;
  hasTextArtifact: boolean;
  hasSource: boolean;
  sourceContent: string;
  sourceFileName: string;
  sourceFileUrl: string;
  pdfUrl: string;
  textArtifactKind: string | null;
}

const LEGACY_SOURCE_ID = 'legacy-repo-source';

export function sourceTextArtifactKind(source: RepositorySource | null): string | null {
  if (!source) return null;
  if (source.source_type === 'pdf') {
    if (source.artifacts.includes('ocr')) return 'ocr';
    if (source.artifacts.includes('latex')) return 'latex';
    return null;
  }
  if (source.artifacts.includes('latex')) return 'latex';
  return source.artifacts.includes('original') ? 'original' : null;
}

export function selectRepositorySource(sources: RepositorySource[], selectedSourceId: string): RepositorySource | null {
  const legacySelected = selectedSourceId === LEGACY_SOURCE_ID || (!selectedSourceId && sources.length === 0);
  if (legacySelected) return null;
  return sources.find((source) => source.id === selectedSourceId) || sources[0] || null;
}

export function sourceEndpoint(
  source: RepositorySource,
  suffix: string,
  owner: string,
  repo: string,
  blueprintId: string,
): string {
  if (!owner || !repo) return '';
  const base = `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const sourcePath = `/sources/${encodeURIComponent(source.id)}/${suffix}`;
  const query = blueprintId ? `?blueprint_id=${encodeURIComponent(blueprintId)}` : '';
  return `${base}${sourcePath}${query}`;
}

function repositorySourceUrls(
  source: RepositorySource,
  owner: string,
  repo: string,
  blueprintId: string,
): { sourceFileUrl: string; pdfUrl: string; textArtifactKind: string | null } {
  const textKind = sourceTextArtifactKind(source);
  return {
    sourceFileUrl: textKind ? sourceEndpoint(source, `artifacts/${encodeURIComponent(textKind)}`, owner, repo, blueprintId) : '',
    pdfUrl: sourceEndpoint(source, 'pdf-preview', owner, repo, blueprintId),
    textArtifactKind: textKind,
  };
}

/** Resolve repository-backed and legacy source fields into one render model. */
export function createSourceDisplayModel(
  props: Required<Pick<SourceModeProps, 'blueprint' | 'repositorySources' | 'selectedSourceId' | 'owner' | 'repo' | 'blueprintId' | 'publicShare'>>,
  selectedSourceText: string,
): SourceDisplayModel {
  const { blueprint, repositorySources, selectedSourceId, owner, repo, blueprintId, publicShare } = props;
  const source = selectRepositorySource(repositorySources, selectedSourceId);
  const legacyContent = blueprint.source_content || '';
  const legacyType = blueprint.source_type || '';
  const urls = source ? repositorySourceUrls(source, owner, repo, blueprintId) : null;
  const hasPdf = source ? source.source_type === 'pdf' && source.artifacts.includes('original') : legacyType === 'pdf';
  const sourceContent = source ? selectedSourceText : legacyContent;
  return {
    selectedRepositorySource: source,
    sourceType: source?.source_type || legacyType,
    hasPdf,
    hasPdfPreview: hasPdf && !publicShare,
    hasTextArtifact: source ? urls?.textArtifactKind !== null : !!legacyContent,
    hasSource: repositorySources.length > 0 || !!legacyContent || legacyType === 'pdf',
    sourceContent,
    sourceFileName: source?.display_name || (hasPdf ? `${blueprint.id}-source-ocr.tex` : `${blueprint.id}-source.tex`),
    sourceFileUrl: source ? urls?.sourceFileUrl || '' : sourceContent ? blueprint.source_file_url || '' : '',
    pdfUrl: publicShare ? '' : source ? urls?.pdfUrl || '' : hasPdf ? blueprint.source_pdf_url || '' : '',
    textArtifactKind: urls?.textArtifactKind ?? null,
  };
}
