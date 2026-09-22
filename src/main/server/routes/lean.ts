/**
 * Lean routes: the Infoview endpoints under
 * `/api/repositories/:owner/:repo/blueprints/:name/lean/*`, the persisted
 * build status, a desktop-only build trigger, and (via `leanSystemRoutes`)
 * the `/api/lean-versions` list the New Project picker reads.
 *
 * Bodies and responses are exactly the web's `schemas/lean.py` shapes;
 * malformed bodies get FastAPI-style 422s.
 */

import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import type { AppContext } from '../context';
import { validationError } from '../errors';
import { roomKeyFor, type OpenProject } from '../../services/types';
import { LeanService, MAX_LEAN_FILE_BYTES } from '../../services/lean';
import { resolveLenient, validateModuleName } from '../../services/lean/paths';
import { listLeanVersions } from '../../services/lean/versions';
import { LeanSetupService } from '../../services/lean/setup';

/** The blueprint service's project resolver, as documented in services/README.md. */
interface BlueprintServiceLike {
  openProject(owner: string, repo: string, blueprintId: string): OpenProject;
}

const REGISTERED = Symbol.for('fuse.lean.shutdownRegistered');

/** Get (or create and register) the Lean service singleton. */
export function getLeanService(ctx: AppContext): LeanService {
  let service = ctx.services.lean as LeanService | undefined;
  if (!(service instanceof LeanService)) {
    service = new LeanService(ctx);
    ctx.services.lean = service;
  }
  const marker = ctx.services as Record<symbol, unknown>;
  if (!marker[REGISTERED]) {
    marker[REGISTERED] = true;
    const lean = service;
    // Chain onto whatever shutdown hook another module already installed.
    const previous = ctx.services.shutdown as (() => Promise<void>) | undefined;
    ctx.services.shutdown = async () => {
      await previous?.();
      await lean.shutdown();
    };
  }
  return service;
}

/**
 * Resolve the route's project through the blueprint service when it is
 * registered, else straight from the registry (same tuple, no metadata).
 */
export function resolveProject(ctx: AppContext, owner: string, repo: string, name: string): OpenProject {
  const blueprints = ctx.services.blueprints as BlueprintServiceLike | undefined;
  if (blueprints && typeof blueprints.openProject === 'function') return blueprints.openProject(owner, repo, name);
  const repository = ctx.registry.requireRepository(owner, repo);
  const blueprint = ctx.registry.requireBlueprint(repository.id, name);
  const clonePath = resolveLenient(repository.path);
  const projectSubdir = (blueprint.project_subdir ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return {
    repository,
    blueprint,
    clonePath,
    projectSubdir,
    projectRoot: projectSubdir ? join(clonePath, ...projectSubdir.split('/')) : clonePath,
    blueprintFile: blueprint.blueprint_file,
    roomKey: roomKeyFor(repository, blueprint.id),
  };
}

type Body = Record<string, unknown>;

async function jsonBody(c: Context): Promise<Body> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw validationError('Request body must be JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('Request body must be a JSON object.');
  return body as Body;
}

/** An empty body means "no options"; anything else must be a JSON object. */
async function optionalJsonBody(c: Context): Promise<Body> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw validationError('Request body must be JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('Request body must be a JSON object.');
  return body as Body;
}

function requireString(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw validationError(`${key} must be a string.`);
  return value;
}

function requireInt(body: Body, key: string, min: number): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) throw validationError(`${key} must be an integer >= ${min}.`);
  return value;
}

function optionalInt(body: Body, key: string, min: number): number | null {
  const value = body[key];
  if (value === null || value === undefined) return null;
  return requireInt(body, key, min);
}

function routeProject(ctx: AppContext, c: Context): OpenProject {
  const { owner, repo, name } = c.req.param() as Record<string, string | undefined>;
  return resolveProject(ctx, owner ?? '', repo ?? '', name ?? '');
}

export function leanRoutes(ctx: AppContext): Hono {
  const lean = getLeanService(ctx);
  const app = new Hono();
  const base = '/:owner/:repo/blueprints/:name';
  const setup = new LeanSetupService(lean);
  const previousShutdown = ctx.services.shutdown as (() => Promise<void>) | undefined;
  ctx.services.shutdown = async () => {
    await Promise.all([setup.shutdown(), previousShutdown?.()]);
  };
  const setupBase = `${base}/lean/setup`;
  app.get(setupBase, async (c) => c.json(await setup.status(routeProject(ctx, c))));
  app.post(setupBase, async (c) => {
    await setup.start(routeProject(ctx, c));
    return c.json({ ok: true }, 202);
  });
  app.post(`${setupBase}/cancel`, (c) => {
    setup.cancel(routeProject(ctx, c));
    return c.json({ ok: true });
  });
  app.post(`${setupBase}/preference`, async (c) => {
    const { repository } = routeProject(ctx, c);
    const body = await jsonBody(c);
    if (typeof body.dismissed !== 'boolean') throw validationError('dismissed must be a boolean.');
    ctx.registry.setLeanSetupDismissed(repository.id, body.dismissed);
    return c.json({ ok: true });
  });

  app.post(`${base}/lean/goals`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await jsonBody(c);
    const request = { file_path: requireString(body, 'file_path'), line: requireInt(body, 'line', 1), column: optionalInt(body, 'column', 1) };
    return c.json(await lean.goals(project, request, c.req.raw.signal));
  });

  app.post(`${base}/lean/hover`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await jsonBody(c);
    const request = { file_path: requireString(body, 'file_path'), line: requireInt(body, 'line', 1), column: requireInt(body, 'column', 1) };
    return c.json(await lean.hover(project, request, c.req.raw.signal));
  });

  app.post(`${base}/lean/reload`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await jsonBody(c);
    return c.json(await lean.reload(project, { file_path: requireString(body, 'file_path') }));
  });

  // Literal `/diagnostics/cached` is registered before the live route so
  // Hono never treats "cached" as a body-less live request.
  app.post(`${base}/lean/diagnostics/cached`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await jsonBody(c);
    const request = { file_path: requireString(body, 'file_path'), start_line: optionalInt(body, 'start_line', 1), end_line: optionalInt(body, 'end_line', 1) };
    return c.json(lean.cachedDiagnostics(project, request));
  });

  app.post(`${base}/lean/diagnostics`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await jsonBody(c);
    const request = { file_path: requireString(body, 'file_path'), start_line: optionalInt(body, 'start_line', 1), end_line: optionalInt(body, 'end_line', 1) };
    return c.json(await lean.diagnostics(project, request, c.req.raw.signal));
  });

  app.post(`${base}/lean/save`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await jsonBody(c);
    const content = requireString(body, 'content');
    if (content.length > MAX_LEAN_FILE_BYTES) throw validationError(`content must be at most ${MAX_LEAN_FILE_BYTES} characters.`);
    return c.json(await lean.save(project, { file_path: requireString(body, 'file_path'), content }));
  });

  app.get(`${base}/build-status`, (c) => {
    const project = routeProject(ctx, c);
    return c.json(lean.buildStatus(project));
  });

  /**
   * Desktop-only trigger. `{target?: "Foo.Bar", wait?: boolean}`: returns
   * 202 `{status: "started"}` and streams progress over the blueprint SSE,
   * or the build outcome when `wait` is true.
   */
  app.post(`${base}/build`, async (c) => {
    const project = routeProject(ctx, c);
    const body = await optionalJsonBody(c);
    let target: string | undefined;
    if (body.target !== undefined && body.target !== null) {
      const candidate = requireString(body, 'target');
      if (validateModuleName(candidate) === null) throw validationError(`target must be a dotted Lean module name (got '${candidate}').`);
      target = candidate;
    }
    const outcome = lean.startBuild(project, { reason: 'manual', target });
    if (body.wait === true) {
      const result = await outcome;
      return c.json({ status: result.status, error: result.error, message: result.output?.message ?? '' });
    }
    outcome.catch(() => {});
    return c.json({ status: 'started', in_progress: lean.buildInProgress(project) }, 202);
  });

  return app;
}

/** Mounted under `/api` by app.ts: the system-level Lean routes. */
export function leanSystemRoutes(ctx: AppContext): Hono {
  // Mounted before the repository sub-apps, so registering here makes
  // `ctx.services.lean` available to every other route factory regardless
  // of mount order.
  getLeanService(ctx);
  const app = new Hono();
  app.get('/lean-versions', async (c) => c.json(await listLeanVersions()));
  return app;
}
