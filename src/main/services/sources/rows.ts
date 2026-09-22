import type { RepositorySourceResponse, SourceArtifactKind } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../store/registry';
import type { RepositoryRow, RepositorySourceRow } from '../../store/rows';
import {
  BLUEPRINT_ID_KEY,
  isActiveSource,
  isSourceVisibleInContext,
  publicSourceMetadata,
  SCOPED_BLUEPRINT_ID_KEY,
  sourceScopedBlueprint,
} from './metadata';
import { MAX_SOURCE_NAME_CHARACTERS } from './validation';

const ARTIFACT_ORDER: SourceArtifactKind[] = ['original', 'latex', 'ocr'];

export function normalizeSourceContext(blueprintId: string | null | undefined): string | null {
  return (blueprintId ?? '').trim() || null;
}

export function activeSourceRows(ctx: AppContext, repositoryId: number): RepositorySourceRow[] {
  return ctx.registry
    .listSources(repositoryId)
    .filter(isActiveSource)
    .sort((left, right) => (left.created_at < right.created_at ? 1 : left.created_at > right.created_at ? -1 : 0));
}

export function visibleSourceRows(ctx: AppContext, repositoryId: number, blueprintId?: string | null): RepositorySourceRow[] {
  const context = normalizeSourceContext(blueprintId);
  return activeSourceRows(ctx, repositoryId).filter((row) => isSourceVisibleInContext(row, context));
}

export function sourceResponse(repository: RepositoryRow, row: RepositorySourceRow): RepositorySourceResponse {
  return {
    id: row.id,
    github_repo_id: repository.id,
    owner: repository.owner,
    repo_name: repository.name,
    display_name: row.display_name,
    source_type: row.source_type,
    status: row.status,
    artifacts: ARTIFACT_ORDER.filter((kind) => Boolean(row.artifacts[kind])),
    metadata: publicSourceMetadata(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function requireVisibleSourceRow(
  ctx: AppContext,
  repository: RepositoryRow,
  sourceId: string,
  blueprintId?: string | null,
): RepositorySourceRow {
  const row = ctx.registry.getSource(repository.id, sourceId);
  const context = normalizeSourceContext(blueprintId);
  if (!row || !isActiveSource(row) || !isSourceVisibleInContext(row, context)) {
    throw new HttpError(404, 'Source not found', 'http_404');
  }
  return row;
}

export function requireAvailableSourceName(
  rows: RepositorySourceRow[],
  name: string,
  scopedBlueprintId: string | null,
  ignoreId?: string,
): void {
  const wanted = name.trim().toLowerCase();
  for (const row of rows) {
    if (row.id === ignoreId || row.display_name.trim().toLowerCase() !== wanted) continue;
    const scope = sourceScopedBlueprint(row);
    if (scope === null || scopedBlueprintId === null || scope === scopedBlueprintId) {
      throw new HttpError(409, `A source named '${name}' already exists.`, 'http_409');
    }
  }
}

export function validateSourceDisplayName(displayName: string | null | undefined, filename: string): string {
  const name = (displayName ?? '').trim() || filename.trim();
  if (name.length > MAX_SOURCE_NAME_CHARACTERS) {
    throw new HttpError(400, `Source names must be ${MAX_SOURCE_NAME_CHARACTERS} characters or fewer.`, 'http_400');
  }
  return name;
}

export function archiveBlueprintSourceRows(ctx: AppContext, repositoryId: number, blueprintName: string): number {
  const rows = activeSourceRows(ctx, repositoryId);
  const matches = rows.filter((row) => {
    const metadata = row.metadata ?? {};
    return metadata[BLUEPRINT_ID_KEY] === blueprintName || metadata[SCOPED_BLUEPRINT_ID_KEY] === blueprintName;
  });
  for (const row of matches) ctx.registry.updateSource(repositoryId, row.id, { status: 'archived' });
  return matches.length;
}
