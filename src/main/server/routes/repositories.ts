/**
 * `/api/repositories/*`: the opened folders. Listing, activity, background
 * sessions, registering/unregistering a folder, branches, lakefile
 * discovery, the Lean project scaffold, and repository file reads.
 */

import { existsSync, promises as fs } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import type {
  RepositoryBackgroundSessionResponse,
  RepositoryBackgroundSessionsResponse,
  RepositoryBranches,
  RepositoryFilesResponse,
  RepositoryListResponse,
  RepositoryResponse,
  RepositorySetupRequest,
} from '@shared/api-types';
import type { AppContext } from '../context';
import { HttpError, validationError } from '../errors';
import type { RepositoryRow } from '../../store/rows';
import { currentBranch, isGitRepository, resolveDefaultBranch, tryGit, weeklyCommits } from '../../services/git';
import {
  deleteWorkspace,
  discoverLakefiles,
  pathResolvesUnder,
  projectFromRows,
  readRepoFile,
  repoFiles,
  repoDirectory,
  repositoryFilePathIsExcluded,
  scaffoldLeanProject,
  sessionService,
} from '../../services/workspace';

const RAW_MEDIA_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

async function lastUpdatedAt(row: RepositoryRow): Promise<string | null> {
  const committed = await tryGit(['log', '-1', '--format=%cI'], { cwd: row.path });
  if (committed?.trim()) return committed.trim();
  try {
    return (await fs.stat(row.path)).mtime.toISOString();
  } catch {
    return null;
  }
}

function backgroundSessionsFor(ctx: AppContext, repositoryId: number): RepositoryBackgroundSessionResponse[] {
  try {
    return sessionService(ctx)?.activeSessionsForRepository?.(repositoryId) ?? [];
  } catch {
    return [];
  }
}

export async function repositoryResponse(
  ctx: AppContext,
  row: RepositoryRow,
  options: { weeklyCommits?: boolean; backgroundSessions?: boolean } = {},
): Promise<RepositoryResponse> {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    updated_at: await lastUpdatedAt(row),
    visibility: 'private',
    weekly_commits: options.weeklyCommits ? await weeklyCommits(row.path) : [],
    background_sessions: options.backgroundSessions ? backgroundSessionsFor(ctx, row.id) : [],
    // Desktop extra: the folder behind this repository, for 'Show in folder'.
    path: row.path,
  } as RepositoryResponse;
}

/** Most recent Fuse activity, falling back to the folder's own last update. */
function activityKey(row: RepositoryRow, response: RepositoryResponse): number {
  const candidates = [row.last_activity_at, response.updated_at, row.created_at]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : 0;
}

async function listResponses(ctx: AppContext, options: { weeklyCommits?: boolean } = {}): Promise<RepositoryResponse[]> {
  const rows = ctx.registry.listRepositories().filter((row) => existsSync(row.path));
  const responses = await Promise.all(rows.map(async (row) => ({ row, response: await repositoryResponse(ctx, row, options) })));
  responses.sort((left, right) => activityKey(right.row, right.response) - activityKey(left.row, left.response));
  return responses.map((entry) => entry.response);
}

/**
 * The base-branch picker's data. A workspace runs on whatever the folder
 * has checked out — nothing is ever checked out or branched for it — so
 * the only honest offer is the current branch (the repository default when
 * HEAD is detached or the folder is not a repository yet).
 */
export async function repositoryBranches(_ctx: AppContext, row: RepositoryRow): Promise<RepositoryBranches> {
  if (!(await isGitRepository(row.path))) return { default_branch: 'main', branches: ['main'] };
  const branch = (await currentBranch(row.path)) ?? (await resolveDefaultBranch(row.path)) ?? 'main';
  return { default_branch: branch, branches: [branch] };
}

export function repositoryRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const body: RepositoryListResponse = { repositories: await listResponses(ctx), repositories_needing_setup: [], hidden_count: 0 };
    return c.json(body);
  });

  app.get('/activity', async (c) => c.json(await listResponses(ctx, { weeklyCommits: true })));

  app.get('/background-sessions', (c) => {
    const body: RepositoryBackgroundSessionsResponse = {};
    for (const row of ctx.registry.listRepositories()) {
      const sessions = backgroundSessionsFor(ctx, row.id);
      if (sessions.length > 0) body[`${row.owner}/${row.name}`] = sessions;
    }
    return c.json(body);
  });

  // Desktop-only: register a folder. The native picker lives on window.fuse;
  // this is the JSON half that turns the chosen path into a repository.
  app.post('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: unknown };
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path) throw validationError('path is required');
    const absolute = resolve(path);
    let isDirectory: boolean;
    try {
      isDirectory = (await fs.stat(absolute)).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) throw new HttpError(404, `Folder not found: ${absolute}`, 'http_404');
    const existing = ctx.registry.getRepositoryByPath(absolute);
    const row = ctx.registry.addRepository(absolute);
    return c.json(await repositoryResponse(ctx, row, { weeklyCommits: true, backgroundSessions: true }), existing ? 200 : 201);
  });

  app.get('/:owner/:repo', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    return c.json(await repositoryResponse(ctx, row, { weeklyCommits: true, backgroundSessions: true }));
  });

  // Desktop-only: forget a folder. The folder itself is never touched, but
  // Fuse's state for it — workspaces, conversations, sources — goes with it
  // so nothing is orphaned under a repository id that no longer exists.
  app.delete('/:owner/:repo', async (c) => {
    const row = ctx.registry.getRepository(c.req.param('owner'), c.req.param('repo'));
    if (!row) throw new HttpError(404, 'Repository not found', 'http_404');
    const sessions = sessionService(ctx);
    if (backgroundSessionsFor(ctx, row.id).some((session) => session.tier === 'active')) {
      throw new HttpError(409, 'Cannot forget a repository with active agent sessions.', 'http_409');
    }
    for (const blueprint of ctx.registry.listBlueprints(row.id)) await deleteWorkspace(ctx, projectFromRows(row, blueprint));
    for (const conversation of ctx.registry.listConversations()) {
      if (conversation.repository_id !== row.id) continue;
      if (sessions?.deleteConversation) {
        await sessions.deleteConversation(conversation.id);
        continue;
      }
      ctx.registry.deleteConversation(conversation.id);
      await fs.rm(ctx.paths.conversationFile(conversation.id), { force: true }).catch(() => undefined);
    }
    ctx.registry.removeRepository(row.id);
    // Land every pending registry write first so nothing recreates the tree.
    ctx.registry.flushSync();
    await fs.rm(ctx.paths.repositoryDir(row.id), { recursive: true, force: true }).catch(() => undefined);
    return c.body(null, 204);
  });

  app.get('/:owner/:repo/branches', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    return c.json(await repositoryBranches(ctx, row));
  });

  app.get('/:owner/:repo/lakefiles', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    return c.json(await discoverLakefiles(row.path, c.req.query('ref')));
  });

  app.post('/:owner/:repo/setup', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const body = (await c.req.json().catch(() => ({}))) as Partial<RepositorySetupRequest>;
    if (typeof body.module_name !== 'string') throw validationError('module_name is required');
    const result = await scaffoldLeanProject(
      row.path,
      {
        moduleName: body.module_name,
        leanVersion: typeof body.lean_version === 'string' ? body.lean_version : null,
        targetSubdir: typeof body.target_subdir === 'string' ? body.target_subdir : null,
        baseBranch: typeof body.base_branch === 'string' ? body.base_branch : null,
      },
    );
    ctx.registry.touchRepository(row.id);
    return c.json(result, 201);
  });

  // ``?ref`` is accepted for compatibility and ignored: the folder is the checkout.
  app.get('/:owner/:repo/files/:path{.+}', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    return c.json(await readRepoFile(row.path, c.req.param('path')));
  });

  app.get('/:owner/:repo/files-raw/:path{.+}', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const relative = c.req.param('path').replace(/\\/g, '/');
    if (relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new HttpError(404, 'File not found', 'http_404');
    }
    if (repositoryFilePathIsExcluded(relative)) throw new HttpError(404, 'File not found', 'http_404');
    const absolute = resolve(row.path, ...relative.split('/'));
    const root = resolve(row.path);
    if (absolute !== root && !absolute.startsWith(root + sep)) throw new HttpError(404, 'File not found', 'http_404');
    if (!(await pathResolvesUnder(absolute, row.path))) throw new HttpError(404, 'File not found', 'http_404');
    let bytes: Buffer;
    try {
      if (!(await fs.stat(absolute)).isFile()) throw new HttpError(400, 'Requested path is not a file.', 'http_400');
      bytes = await fs.readFile(absolute);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(404, 'File not found', 'http_404');
    }
    c.header('Content-Type', RAW_MEDIA_TYPES[extname(relative).toLowerCase()] ?? 'application/octet-stream');
    c.header('X-Content-Type-Options', 'nosniff');
    // Hono wants a Uint8Array over a plain ArrayBuffer; Buffer may be pooled.
    return c.body(new Uint8Array(bytes));
  });

  const listFiles = async (owner: string, repo: string, blueprintName: string): Promise<RepositoryFilesResponse> => {
    const row = ctx.registry.requireRepository(owner, repo);
    if (!blueprintName) throw validationError('blueprint_name is required');
    ctx.registry.requireBlueprint(row.id, blueprintName);
    return repoFiles(row.path);
  };

  app.get('/:owner/:repo/repo-files', async (c) =>
    c.json(await listFiles(c.req.param('owner'), c.req.param('repo'), (c.req.query('blueprint_name') ?? '').trim())),
  );
  app.get('/:owner/:repo/blueprints/:name/directory', async (c) => {
    const row = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    ctx.registry.requireBlueprint(row.id, c.req.param('name'));
    return c.json(await repoDirectory(row.path, c.req.query('path') ?? ''));
  });
  app.get('/:owner/:repo/blueprints/:name/files', async (c) =>
    c.json(await listFiles(c.req.param('owner'), c.req.param('repo'), c.req.param('name'))),
  );

  return app;
}
