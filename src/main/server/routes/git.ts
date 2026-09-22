/**
 * `/api/repositories/:owner/:repo/blueprints/:name/{commits,diff,commit,
 * sync,sync-main,branch-status,branch-freshness}`: the Git tab. Every route
 * runs against the repository folder on its checked-out branch; a folder
 * that is not a git repository reads as empty and refuses writes with 409.
 */

import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import type { BlueprintCommitDetail, BlueprintCommitRequest, BlueprintMainSyncRequest } from '@shared/api-types';
import type { AppContext } from '../context';
import { HttpError, validationError } from '../errors';
import {
  branchFreshness,
  branchStatus,
  commitChanges,
  commitDetail,
  currentBranch,
  currentGitIdentity,
  githubRemote,
  isGitRepository,
  listCommits,
  syncBranch,
  syncFromMain,
  workingTreeDiff,
  hasRemote,
} from '../../services/git';
import { collectBlueprintIncludedFiles } from '../../services/blueprint/metadata';
import type { OpenProject } from '../../services/types';
import { blueprintService, publishBlueprintEvent, resolveProject } from '../../services/workspace';

const NOT_A_REPOSITORY = 'This folder is not a git repository.';

/** Git internals and Fuse's own metadata: never a commit scope. */
function overlapsProtectedState(path: string): boolean {
  const parts = path.split('/');
  return ['.git', '.github', 'numina'].includes(parts[0]);
}

function isUnder(path: string, scope: string): boolean {
  return path === scope || path.startsWith(`${scope}/`);
}

/**
 * Positive pathspecs a nested-project workspace may commit besides its
 * project (the web's ``blueprint_additional_writable_paths``): the
 * blueprint entrypoint's folder when it is a ``.../blueprint/src`` outside
 * the project (else the entrypoint file), plus every transitively
 * ``\input`` file outside the project that is not already covered.
 */
export function additionalWritablePaths(project: OpenProject): string[] {
  if (!project.projectSubdir || !project.blueprintFile) return [];
  const entrypoint = project.blueprintFile.replace(/^\/+/, '');
  if (isUnder(entrypoint, project.projectSubdir)) return [];
  const parts = entrypoint.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return [];
  if (overlapsProtectedState(entrypoint)) return [];
  const folder = dirname(entrypoint).replace(/\\/g, '/');
  const isBlueprintSrc = folder.endsWith('/src') && dirname(folder).split('/').pop() === 'blueprint';
  const projectInside = isUnder(project.projectSubdir, folder);
  const scopes = [isBlueprintSrc && !projectInside ? folder : entrypoint];
  let included: string[];
  try {
    included = collectBlueprintIncludedFiles(join(project.clonePath, ...parts), project.clonePath);
  } catch {
    included = [];
  }
  for (const path of included.slice(1)) {
    if (isUnder(path, project.projectSubdir) || overlapsProtectedState(path)) continue;
    if (scopes.some((scope) => isUnder(path, scope))) continue;
    scopes.push(path);
  }
  return scopes;
}

async function refreshAfterGit(ctx: AppContext, project: OpenProject): Promise<void> {
  try {
    await blueprintService(ctx)?.refresh(project);
  } catch (error) {
    console.warn(`[git] metadata refresh after git operation failed for ${project.roomKey}:`, error);
  }
  publishBlueprintEvent(ctx, project, 'blueprint_sync', { blueprint: project.blueprint.id });
  ctx.registry.touchRepository(project.repository.id);
}


export function gitRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const base = '/:owner/:repo/blueprints/:name';

  const project = (c: { req: { param(name: string): string } }): OpenProject =>
    resolveProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('name'));

  app.get(`${base}/commits`, async (c) => {
    const raw = c.req.query('limit');
    let limit = 50;
    if (raw !== undefined && raw !== '') {
      limit = Number.parseInt(raw, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationError('limit must be between 1 and 100');
    }
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) return c.json({ commits: [] });
    const github = await githubRemote(opened.clonePath);
    return c.json({ commits: await listCommits(opened.clonePath, 'HEAD', limit, { github }) });
  });

  app.get(`${base}/commits/:sha`, async (c) => {
    const opened = project(c);
    let detail: BlueprintCommitDetail | null = null;
    if (await isGitRepository(opened.clonePath)) {
      detail = await commitDetail(opened.clonePath, c.req.param('sha'), { github: await githubRemote(opened.clonePath) });
    }
    if (!detail) throw new HttpError(404, 'Commit not found', 'http_404');
    return c.json(detail);
  });

  app.get(`${base}/diff`, async (c) => {
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) return c.json({ files: [] });
    return c.json(await workingTreeDiff(opened.clonePath));
  });

  app.post(`${base}/commit`, async (c) => {
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) throw new HttpError(409, NOT_A_REPOSITORY, 'http_409');
    const body = (await c.req.json().catch(() => ({}))) as BlueprintCommitRequest;
    const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
    const { identity } = await currentGitIdentity(opened.clonePath);
    const footer = `User: ${identity.name}\nBlueprint: ${opened.blueprint.id}\nRepository: ${opened.repository.owner}/${opened.repository.name}`;
    const result = await commitChanges(opened.clonePath, {
      message: userMessage,
      body: footer,
      identity,
      author: identity,
      projectSubdir: opened.projectSubdir,
      additionalPaths: additionalWritablePaths(opened),
      push: false,
      validate: true,
    });
    if (result.status === 'committed' || result.status === 'push_failed') await refreshAfterGit(ctx, opened);
    return c.json(result);
  });

  app.post(`${base}/sync`, async (c) => {
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) throw new HttpError(409, NOT_A_REPOSITORY, 'http_409');
    const branch = await currentBranch(opened.clonePath);
    if (!branch) throw new HttpError(409, 'The repository is not on a branch; check out a branch before syncing.', 'http_409');
    const result = await syncBranch(opened.clonePath, branch);
    if (result.status === 'updated') await refreshAfterGit(ctx, opened);
    return c.json(result);
  });

  app.post(`${base}/sync-main`, async (c) => {
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) throw new HttpError(409, NOT_A_REPOSITORY, 'http_409');
    const body = (await c.req.json().catch(() => ({}))) as BlueprintMainSyncRequest;
    const { identity } = await currentGitIdentity(opened.clonePath);
    const result = await syncFromMain(opened.clonePath, {
      base: typeof body.branch === 'string' ? body.branch : null,
      identity,
      validate: true,
    });
    if (result.status === 'updated') await refreshAfterGit(ctx, opened);
    return c.json(result);
  });

  // Desktop shape: the checked-out branch plus whether a remote exists, so the
  // Git tab can disable sync/push locally; `status` keeps the web's
  // BlueprintBranchStatus for the remote-tracking case.
  app.get(`${base}/branch-status`, async (c) => {
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) return c.json({ branch: null, has_remote: false, status: null });
    const branch = await currentBranch(opened.clonePath);
    const remote = await hasRemote(opened.clonePath);
    const status = branch && remote ? await branchStatus(opened.clonePath, branch) : null;
    return c.json({ branch, has_remote: remote, status });
  });

  app.get(`${base}/branch-freshness`, async (c) => {
    const opened = project(c);
    if (!(await isGitRepository(opened.clonePath))) return c.json(null);
    return c.json(await branchFreshness(opened.clonePath));
  });

  return app;
}
