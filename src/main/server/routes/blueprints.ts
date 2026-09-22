/**
 * `/api/repositories/:owner/:repo/blueprints/*` — the web's blueprint
 * routers (read, detail, edit, settings, source_files, delete, create,
 * event_stream) over the local folder. Git history/commit routes live in
 * routes/git.ts and the Lean routes in routes/lean.ts.
 */

import { existsSync, statSync } from 'node:fs';
import { sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { BlueprintBuildStatus, BuildErrorCounts, BuildSnapshotEvent, CreateWorkspaceFields } from '@shared/api-types';
import { EFFORT_LEVELS, type EffortLevel } from '@shared/agent-events';
import {
  BlueprintService,
  MAX_LATEX_SOURCE_CHARACTERS,
  MAX_ORCHESTRATOR_CONCURRENCY,
  absolutePathIn,
  safeBlueprintFilePath,
} from '@main/services/blueprint-service';
import { readSnapshot, repoRelativeCounts, snapshotCounts, snapshotMtime } from '@main/services/lean/build/snapshot';
import { readBuildStamp } from '@main/services/lean/build/stamp';
import { pdfPageCount } from '@main/services/sources/pdf';
import { normalizeRepositoryFilePath, repositoryFilePathIsExcluded } from '@main/services/sources';
import type { OpenProject } from '@main/services/types';
import type { AppContext } from '../context';
import { HttpError, validationError } from '../errors';
import type { SseFrame, SseRoom } from '../sse';

/** `MAX_SOURCE_UPLOAD_BYTES` / `SOURCE_UPLOAD_TOO_LARGE_DETAIL` in the web backend. */
export const MAX_SOURCE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const SOURCE_UPLOAD_TOO_LARGE_DETAIL = 'File is too large. Maximum upload size is 20 MB.';
const SUBSCRIBER_QUEUE_LIMIT = 256;

// ── Body schemas (pydantic `extra=forbid` ⇒ unknown keys are 422) ──────────

const contentBody = z.object({ latex_source: z.string() }).strict();
const chapterBody = z.object({ content: z.string() }).strict();
const sourceFileBody = z.object({ blueprint_file: z.string() }).strict();
const agentPatch = z
  .object({
    provider: z.enum(['claude', 'codex']).optional(),
    model: z.string().optional(),
    effort: z.enum(EFFORT_LEVELS as unknown as [EffortLevel, ...EffortLevel[]]).nullable().optional(),
    claude_permission_mode: z.enum(['manual', 'acceptEdits', 'plan', 'bypassPermissions']).optional(),
    codex_sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  })
  .strict();
const settingsBody = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    pr_mode: z.enum(['off', 'draft', 'ready']).optional(),
    auto_commit: z.boolean().optional(),
    orchestrator_child_concurrency: z.number().int().min(1).max(MAX_ORCHESTRATOR_CONCURRENCY).optional(),
    agent: agentPatch.optional(),
  })
  .strict();

/** A route parameter (Hono decodes percent-encoding; a missing one is a routing bug). */
function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) throw new HttpError(404, 'Not found', 'http_404');
  return value;
}

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validationError('Request body must be JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw validationError(`${where}${issue?.message ?? 'Invalid request body.'}`);
  }
  return result.data;
}

/** `_require_content_size`: the web's 422 for oversized LaTeX bodies. */
function requireContentSize(content: string, label: string): void {
  if (content.length > MAX_LATEX_SOURCE_CHARACTERS) {
    throw validationError(
      `${label} is too large (${content.length.toLocaleString('en-US')} characters). Maximum is ${MAX_LATEX_SOURCE_CHARACTERS.toLocaleString('en-US')} characters.`,
    );
  }
}

/** FastAPI `Query(..., min_length=1, max_length=512)`. */
function chapterPathQuery(c: Context): string {
  const path = c.req.query('path');
  if (path === undefined) throw validationError('path: Field required');
  if (path.length < 1) throw validationError('path: String should have at least 1 character');
  if (path.length > 512) throw validationError('path: String should have at most 512 characters');
  return path;
}

/** True when `candidate` (which must exist) resolves inside `root` after following symlinks. */
async function resolvesUnder(candidate: string, root: string): Promise<boolean> {
  try {
    const [real, realRoot] = await Promise.all([realpath(candidate), realpath(root)]);
    return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`);
  } catch {
    return false;
  }
}

interface UploadPart {
  name: string;
  size: number;
  bytes: () => Promise<Buffer>;
}

/** Read one multipart form: string fields plus an optional `file` part. */
async function parseMultipart(c: Context): Promise<{ fields: Record<string, string>; file: UploadPart | null }> {
  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw new HttpError(400, 'Malformed multipart form data.', 'http_400');
  }
  const fields: Record<string, string> = {};
  let file: UploadPart | null = null;
  for (const [key, value] of Object.entries(body)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first instanceof File) {
      if (key === 'file' && first.name) {
        file = { name: first.name, size: first.size, bytes: async () => Buffer.from(await first.arrayBuffer()) };
      }
      continue;
    }
    if (typeof first === 'string') fields[key] = first;
  }
  return { fields, file };
}

// ── Build state (the Lean service when registered, else its on-disk files) ──

interface LeanServiceLike {
  buildSnapshot?: (project: OpenProject) => BuildSnapshotEvent | null;
  errorCounts?: (project: OpenProject) => BuildErrorCounts;
  buildStatus?: (project: OpenProject) => BlueprintBuildStatus;
}

function errorCounts(ctx: AppContext, project: OpenProject): BuildErrorCounts {
  const lean = ctx.services.lean as LeanServiceLike | undefined;
  if (lean?.errorCounts) {
    try {
      return lean.errorCounts(project);
    } catch (error) {
      console.warn(`[blueprints] lean.errorCounts failed for ${project.roomKey}:`, error);
    }
  }
  return errorCountsFromDisk(project);
}

function buildSnapshot(ctx: AppContext, project: OpenProject): BuildSnapshotEvent | null {
  const lean = ctx.services.lean as LeanServiceLike | undefined;
  if (lean?.buildSnapshot) {
    try {
      return lean.buildSnapshot(project);
    } catch (error) {
      console.warn(`[blueprints] lean.buildSnapshot failed for ${project.roomKey}:`, error);
    }
  }
  // Without a live build state only the persisted stamp speaks: any stamp
  // (even one recording errors) means the project has been built.
  return readBuildStamp(project.projectRoot) ? { status: 'done', steps: [] } : null;
}

function errorCountsFromDisk(project: OpenProject): BuildErrorCounts {
  return repoRelativeCounts(snapshotCounts(readSnapshot(project.projectRoot)), project.projectSubdir);
}

/**
 * The blueprint stream (`api/blueprints/event_stream.py`): snapshot frames,
 * then live room events; on every heartbeat tick (and after each live
 * event) the build-errors snapshot file's mtime is polled so writes from
 * the out-of-process MCP server reach the UI. No replay: the web stream has
 * no cursor, and the frontend refetches after any reconnect.
 */
function respondEvents(c: Context, ctx: AppContext, service: BlueprintService, project: OpenProject, room: SseRoom): Response {
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache');
  const release = service.retainRoom(project);
  return streamSSE(c, async (stream) => {
    const queue: Array<SseFrame | null> = [];
    let wake: (() => void) | null = null;
    let overflowed = false;
    const unsubscribe = room.subscribe((frame) => {
      if (frame !== null && queue.length >= SUBSCRIBER_QUEUE_LIMIT) {
        overflowed = true;
        wake?.();
        return;
      }
      queue.push(frame);
      wake?.();
    });
    stream.onAbort(() => wake?.());
    const waitForFrame = (): Promise<boolean> =>
      new Promise((resolveWait) => {
        if (queue.length > 0 || overflowed) {
          resolveWait(true);
          return;
        }
        const timer = setTimeout(() => {
          wake = null;
          resolveWait(false);
        }, service.heartbeatMs);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolveWait(true);
        };
      });
    const write = async (event: string, data: unknown, id?: number): Promise<void> => {
      await stream.writeSSE({
        event,
        data: data === '' || data === undefined ? '' : JSON.stringify(data),
        ...(id !== undefined ? { id: String(id) } : {}),
      });
    };
    let lastMtime = snapshotMtime(project.projectRoot);
    const emitIfSnapshotChanged = async (): Promise<void> => {
      const mtime = snapshotMtime(project.projectRoot);
      if (mtime === null || mtime === lastMtime) return;
      lastMtime = mtime;
      await write('build_errors_updated', { files: errorCounts(ctx, project) });
    };
    try {
      const snapshot = buildSnapshot(ctx, project);
      if (snapshot) await write('build_snapshot', snapshot);
      await write('build_errors_snapshot', { files: errorCounts(ctx, project) });
      lastMtime = snapshotMtime(project.projectRoot);
      while (!stream.aborted) {
        const ready = await waitForFrame();
        if (stream.aborted) break;
        if (!ready) {
          await emitIfSnapshotChanged();
          await stream.writeSSE({ event: 'heartbeat', data: '' });
          continue;
        }
        if (overflowed) {
          overflowed = false;
          queue.length = 0;
          await write('buffer_overflow', { message: 'Blueprint event stream fell behind. Reconnect to refresh.' });
          continue;
        }
        const frame = queue.shift();
        if (frame === undefined) continue;
        if (frame === null) break;
        await write(frame.event, frame.data, frame.id);
        if (frame.event === 'build_errors_updated') lastMtime = snapshotMtime(project.projectRoot);
        else await emitIfSnapshotChanged();
      }
    } catch (error) {
      console.error(`[blueprints] event stream failed for ${project.roomKey}:`, error);
      try {
        await write('error', { message: 'Blueprint event stream encountered an unexpected error. Please reconnect.' });
      } catch {
        // The client is gone.
      }
    } finally {
      unsubscribe();
      release();
    }
  });
}

export function blueprintRoutes(ctx: AppContext): Hono {
  const service = (ctx.services.blueprints as BlueprintService | undefined) ?? new BlueprintService(ctx);
  ctx.services.blueprints = service;
  const app = new Hono();
  const base = '/:owner/:repo/blueprints';
  const open = (c: Context): OpenProject => service.openProject(param(c, 'owner'), param(c, 'repo'), param(c, 'name'));

  app.get(base, async (c) => {
    const repository = ctx.registry.requireRepository(param(c, 'owner'), param(c, 'repo'));
    return c.json(await service.listBlueprints(repository));
  });

  app.post(`${base}/pdf-info`, async (c) => {
    ctx.registry.requireRepository(param(c, 'owner'), param(c, 'repo'));
    const { file } = await parseMultipart(c);
    if (!file || !file.name.endsWith('.pdf')) throw new HttpError(400, 'File must be a PDF.', 'http_400');
    if (file.size > MAX_SOURCE_UPLOAD_BYTES) throw new HttpError(400, SOURCE_UPLOAD_TOO_LARGE_DETAIL, 'http_400');
    let pageCount: number;
    try {
      pageCount = await pdfPageCount(await file.bytes());
    } catch {
      throw new HttpError(400, 'Could not read PDF file.', 'http_400');
    }
    return c.json({ page_count: pageCount });
  });

  app.post(`${base}/create-workspace`, async (c) => {
    const repository = ctx.registry.requireRepository(param(c, 'owner'), param(c, 'repo'));
    const { fields, file } = await parseMultipart(c);
    if (!fields.title) throw new HttpError(400, 'Title is required', 'http_400');
    const upload = file ? { name: file.name, bytes: await file.bytes() } : undefined;
    if (upload && upload.bytes.byteLength > MAX_SOURCE_UPLOAD_BYTES) throw new HttpError(400, SOURCE_UPLOAD_TOO_LARGE_DETAIL, 'http_400');
    const response = await service.createWorkspace(repository, fields as unknown as CreateWorkspaceFields, upload);
    return c.json(response);
  });

  app.get(`${base}/:name`, async (c) => c.json(await service.getBlueprint(open(c))));

  app.get(`${base}/:name/events`, (c) => {
    const project = open(c);
    return respondEvents(c, ctx, service, project, ctx.blueprintRooms.get(project.roomKey));
  });

  app.put(`${base}/:name/content`, async (c) => {
    const body = await parseJson(c, contentBody);
    requireContentSize(body.latex_source, 'LaTeX source');
    await service.writeContent(open(c), body.latex_source);
    return c.body(null, 204);
  });

  app.get(`${base}/:name/chapter`, async (c) => {
    const path = chapterPathQuery(c);
    return c.json(await service.readChapter(open(c), path));
  });

  app.put(`${base}/:name/chapter`, async (c) => {
    const path = chapterPathQuery(c);
    const body = await parseJson(c, chapterBody);
    requireContentSize(body.content, 'Chapter content');
    await service.writeChapter(open(c), path, body.content);
    return c.body(null, 204);
  });

  app.patch(`${base}/:name/settings`, async (c) => {
    const body = await parseJson(c, settingsBody);
    return c.json(service.updateSettings(open(c), body));
  });

  app.put(`${base}/:name/source-file`, async (c) => {
    const body = await parseJson(c, sourceFileBody);
    const safePath = safeBlueprintFilePath(body.blueprint_file);
    if (safePath === null) throw new HttpError(400, 'blueprint_file must be a repository-relative .tex path.', 'http_400');
    const project = open(c);
    const target = absolutePathIn(project.clonePath, safePath);
    // A symlink inside the folder can still point outside it; refuse those.
    if (!existsSync(target) || !statSync(target).isFile() || !(await resolvesUnder(target, project.clonePath))) {
      throw new HttpError(404, `No file at ${safePath} in this branch.`, 'http_404');
    }
    return c.json(await service.setSourceFile(project, safePath, { requireDeclarations: true }));
  });

  app.put(`${base}/:name/lean-project`, async (c) => {
    const body = await parseJson(c, z.object({ lakefile: z.string() }).strict());
    let path: string;
    try { path = normalizeRepositoryFilePath(body.lakefile); }
    catch { throw validationError('Choose a repository-relative lakefile.'); }
    if (!/(^|\/)lakefile\.(lean|toml)$/.test(path) || repositoryFilePathIsExcluded(path)) {
      throw validationError('Choose a lakefile.lean or lakefile.toml inside this repository.');
    }
    const project = open(c);
    const absolute = absolutePathIn(project.clonePath, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile() || !(await resolvesUnder(absolute, project.clonePath))) {
      throw new HttpError(404, 'That lakefile is no longer available.', 'http_404');
    }
    const slash = path.lastIndexOf('/');
    return c.json(await service.setLeanProject(project, slash < 0 ? '' : path.slice(0, slash)));
  });

  app.post(`${base}/:name/create-blueprint`, async (c) => c.json(await service.createBlueprint(open(c))));

  app.get(`${base}/:name/source-candidates`, async (c) => c.json({ files: await service.listSourceCandidates(open(c)) }));

  app.delete(`${base}/:name`, async (c) => {
    await service.deleteBlueprint(open(c));
    return c.body(null, 204);
  });

  return app;
}
