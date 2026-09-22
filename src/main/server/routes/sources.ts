/**
 * `/api/repositories/:owner/:repo/sources/*`: repository sources. Listing,
 * multipart upload, import from the folder, delete, and artifact serving
 * with HTTP Range support (the Source panel asks for the first 64 KB and
 * reads Content-Range to decide whether the preview is truncated).
 */

import { promises as fs } from 'node:fs';
import { Hono, type Context } from 'hono';
import type { RepositorySourceImportRequest, RepositorySourceListResponse } from '@shared/api-types';
import type { AppContext } from '../context';
import { HttpError, validationError } from '../errors';
import { MAX_SOURCE_UPLOAD_BYTES, SOURCE_UPLOAD_TOO_LARGE_DETAIL, type SourceService } from '../../services/sources';
import { registerSourceService } from '../../services/sources';
import { resolveProject } from '../../services/workspace';

/** ``bytes=start-end`` → inclusive byte range within ``size``, or null. */
export function parseRangeHeader(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = Number.parseInt(rawEnd, 10);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : Math.min(Number.parseInt(rawEnd, 10), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * Serve a stored artifact honouring ``Range`` (206 + Content-Range) with
 * ``X-Content-Type-Options: nosniff`` so uploaded bytes are never sniffed
 * into an executable type.
 */
export async function serveArtifact(c: Context, path: string, mediaType: string): Promise<Response> {
  let size: number;
  try {
    size = (await fs.stat(path)).size;
  } catch {
    throw new HttpError(404, 'Artifact not found', 'http_404');
  }
  const headers: Record<string, string> = {
    'Content-Type': mediaType,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  const range = parseRangeHeader(c.req.header('range'), size);
  if (range === 'unsatisfiable') {
    return c.body(null, 416, { ...headers, 'Content-Range': `bytes */${size}` });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  const buffer = new Uint8Array(length);
  if (length > 0) {
    const handle = await fs.open(path, 'r');
    try {
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
    } finally {
      await handle.close();
    }
  }
  headers['Content-Length'] = String(length);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return c.body(buffer, range ? 206 : 200, headers);
}

async function uploadedFile(value: unknown): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!(value instanceof File)) return null;
  if (value.size > MAX_SOURCE_UPLOAD_BYTES) throw new HttpError(400, SOURCE_UPLOAD_TOO_LARGE_DETAIL, 'http_400');
  return { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
}

export function sourceRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const service: SourceService = registerSourceService(ctx);
  const base = '/:owner/:repo/sources';
  const context = (c: Context): string | null => (c.req.query('blueprint_id') ?? '').trim() || null;

  app.get(base, (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const body: RepositorySourceListResponse = { sources: service.list(repository, context(c)) };
    return c.json(body);
  });

  app.post(base, async (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const form = await c.req.parseBody();
    const file = await uploadedFile(form.file);
    if (!file) throw validationError('file is required');
    const displayName = typeof form.display_name === 'string' ? form.display_name : null;
    const projectScoped = form.project_scoped === 'true' || form.project_scoped === 'on' || form.project_scoped === '1';
    const blueprintId = typeof form.blueprint_id === 'string' ? form.blueprint_id : null;
    return c.json(await service.upload(repository, file, { displayName, projectScoped, blueprintId }));
  });

  app.post(`${base}/import`, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<RepositorySourceImportRequest>;
    if (typeof body.blueprint_id !== 'string' || !body.blueprint_id || typeof body.repo_path !== 'string' || !body.repo_path) {
      throw validationError('blueprint_id and repo_path are required');
    }
    const project = resolveProject(ctx, c.req.param('owner'), c.req.param('repo'), body.blueprint_id);
    const created = await service.importRepositoryFile(project, body.repo_path);
    ctx.registry.touchRepository(project.repository.id);
    return c.json(created);
  });

  app.get(`${base}/:source_id`, (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    return c.json(service.get(repository, c.req.param('source_id'), context(c)));
  });

  app.delete(`${base}/:source_id`, async (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    await service.delete(repository, c.req.param('source_id'), context(c));
    return c.body(null, 204);
  });

  app.get(`${base}/:source_id/artifacts/:kind`, async (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const artifact = service.artifact(repository, c.req.param('source_id'), c.req.param('kind'), context(c));
    return serveArtifact(c, artifact.path, artifact.mediaType);
  });

  app.get(`${base}/:source_id/pdf-preview`, async (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const preview = service.pdfPreview(repository, c.req.param('source_id'), context(c));
    return serveArtifact(c, preview.path, 'application/pdf');
  });

  return app;
}
