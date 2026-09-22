import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppContext } from '../../server/context';
import type { BlueprintRow, ConversationRow } from '../../store/rows';
import { clonePathOf, defaultBlueprintFileForProject, normalizeProjectSubdir, resolveExistingEntrypoint, safeBlueprintFilePath } from '../blueprint';
import { roomKeyFor, type OpenProject } from '../types';

export function absolutePathIn(clonePath: string, relative: string): string {
  return clonePathOf(clonePath, relative);
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolve a route triple and adopt an existing conventional entrypoint once. */
export function openBlueprintProject(ctx: AppContext, owner: string, repo: string, blueprintId: string): OpenProject {
  const repository = ctx.registry.requireRepository(owner, repo);
  let blueprint = ctx.registry.requireBlueprint(repository.id, blueprintId);
  const clonePath = resolve(repository.path);
  const projectSubdir = normalizeProjectSubdir(blueprint.project_subdir ?? '');
  const projectRoot = projectSubdir ? absolutePathIn(clonePath, projectSubdir) : clonePath;
  let blueprintFile = safeBlueprintFilePath(blueprint.blueprint_file);
  if (blueprintFile === null) {
    const candidate = defaultBlueprintFileForProject(projectSubdir);
    if (isFile(absolutePathIn(clonePath, candidate))) {
      blueprint = ctx.registry.updateBlueprint(repository.id, blueprint.id, { blueprint_file: candidate });
      blueprintFile = candidate;
    } else {
      blueprintFile = resolveExistingEntrypoint(clonePath, blueprint.id, null, projectSubdir);
    }
  }
  return {
    repository,
    blueprint,
    clonePath,
    projectSubdir,
    projectRoot,
    blueprintFile,
    roomKey: roomKeyFor(repository, blueprint.id),
  };
}

export function blueprintUpdatedAt(row: BlueprintRow, conversations: ConversationRow[]): string | null {
  const activity = conversations
    .filter((conversation) => conversation.repository_id === row.repository_id && conversation.blueprint_id === row.id)
    .map((conversation) => conversation.updated_at);
  let best: string | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const value of [row.created_at, row.updated_at, ...activity]) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time) || time <= bestTime) continue;
    best = value;
    bestTime = time;
  }
  return best;
}
