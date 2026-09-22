/**
 * Structural views of the services this module and its routes collaborate
 * with. They mirror the signatures in services/README.md so the modules can
 * be built independently: everything is looked up on ``ctx.services`` at
 * call time and treated as optional.
 */

import { join } from 'node:path';
import type { BlueprintResponse, RepositoryBackgroundSessionResponse } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../store/registry';
import type { BlueprintRow, RepositoryRow } from '../../store/rows';
import { roomKeyFor, type OpenProject } from '../types';
import type { SourceService } from '../sources';

export interface BlueprintServiceLike {
  openProject(owner: string, repo: string, blueprintId: string): OpenProject;
  getBlueprint(project: OpenProject): Promise<BlueprintResponse>;
  refresh(project: OpenProject): Promise<void>;
  publish(project: OpenProject, event: string, data: unknown): void;
}

export interface LeanServiceLike {
  startBuild(project: OpenProject, opts?: { reason?: string; target?: string }): Promise<unknown>;
}

export interface SessionServiceLike {
  activeSessionsForRepository(repositoryId: number): RepositoryBackgroundSessionResponse[];
  /** Optional: whether an agent turn is live for a blueprint (delete guard). */
  hasActiveSession?(repositoryId: number, blueprintId: string | null): boolean;
  /** Optional: remove a conversation and its transcript (delete cleanup). */
  deleteConversation?(conversationId: string): Promise<void> | void;
}

export function blueprintService(ctx: AppContext): BlueprintServiceLike | null {
  return (ctx.services.blueprints as BlueprintServiceLike | undefined) ?? null;
}

export function leanService(ctx: AppContext): LeanServiceLike | null {
  return (ctx.services.lean as LeanServiceLike | undefined) ?? null;
}

export function sessionService(ctx: AppContext): SessionServiceLike | null {
  return (ctx.services.sessions as SessionServiceLike | undefined) ?? null;
}

export function sourceService(ctx: AppContext): SourceService {
  const service = ctx.services.sources as SourceService | undefined;
  if (!service) throw new HttpError(503, 'Sources are not available yet.', 'http_503');
  return service;
}

/** Build the project tuple from registry rows (what ``openProject`` returns). */
export function projectFromRows(repository: RepositoryRow, blueprint: BlueprintRow): OpenProject {
  const projectSubdir = blueprint.project_subdir.replace(/^\/+|\/+$/g, '');
  return {
    repository,
    blueprint,
    clonePath: repository.path,
    projectSubdir,
    projectRoot: projectSubdir ? join(repository.path, ...projectSubdir.split('/')) : repository.path,
    blueprintFile: blueprint.blueprint_file,
    roomKey: roomKeyFor(repository, blueprint.id),
  };
}

const BLUEPRINT_NAME = /^[a-z0-9-]+$/;

export function isValidBlueprintName(name: string): boolean {
  return BLUEPRINT_NAME.test(name);
}

/**
 * Resolve ``owner/repo/name`` to an open project: through the blueprint
 * service when it is registered (it may keep extra state), else straight
 * from the registry. 400 for a malformed name, 404 when unknown.
 */
export function resolveProject(ctx: AppContext, owner: string, repo: string, name: string): OpenProject {
  if (!isValidBlueprintName(name)) throw new HttpError(400, 'Invalid blueprint name', 'http_400');
  const service = blueprintService(ctx);
  if (service) return service.openProject(owner, repo, name);
  const repository = ctx.registry.requireRepository(owner, repo);
  return projectFromRows(repository, ctx.registry.requireBlueprint(repository.id, name));
}

/** Publish ``blueprint_sync`` (and friends) on the blueprint's SSE room. */
export function publishBlueprintEvent(ctx: AppContext, project: OpenProject, event: string, data: unknown): void {
  const service = blueprintService(ctx);
  if (service) {
    service.publish(project, event, data);
    return;
  }
  ctx.blueprintRooms.get(project.roomKey).publish(event, data);
}
