/**
 * The local HTTP backend. It serves the same `/api/...` routes the Fuse web
 * frontend calls, plus the built renderer as static files, on a loopback
 * port with a per-launch session token, so the frontend runs verbatim:
 * relative fetches, EventSource streams, cookies, uploads and BrowserRouter
 * all behave as they do against the hosted backend.
 *
 * Route modules live in ./routes and each exports a Hono sub-app mounted here.
 */

import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Hono, type Context, type Next } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { errorResponse } from './errors';
import type { AppContext } from './context';
import { authRoutes } from './routes/auth';
import { systemRoutes } from './routes/system';
import { repositoryRoutes } from './routes/repositories';
import { sourceRoutes } from './routes/sources';
import { blueprintRoutes } from './routes/blueprints';
import { gitRoutes } from './routes/git';
import { leanRoutes } from './routes/lean';
import { sessionRoutes } from './routes/sessions';
import { pullRequestRoutes } from './routes/pull-requests';
import { internalRoutes } from './routes/internal';
import { leanSystemRoutes } from './routes/lean';

export const SESSION_COOKIE = 'fuse_session';
const TOKEN_QUERY = 'fuse_token';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export interface LocalServer {
  baseUrl: string;
  port: number;
  token: string;
  /** URL that sets the session cookie and lands on the app. */
  entryUrl(path?: string): string;
  close(): Promise<void>;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const value = safeDecode(part.slice(index + 1).trim());
    if (value !== null) out[part.slice(0, index).trim()] = value;
  }
  return out;
}

/** `decodeURIComponent` that treats malformed escapes (e.g. `%E0%A4%A`) as absent instead of throwing. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The hosted app's hardening headers (deploy/nginx/fuse.conf), reproduced for
 * the loopback origin: the renderer paints repository- and agent-authored
 * HTML/markdown, and an injected script could otherwise call every /api
 * route with the session cookie. Everything the bundle needs is same-origin;
 * `wasm-unsafe-eval` is for pdf.js's decoders, blob workers for elk/pdf.js.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

function securityHeaders(c: Context): void {
  c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function buildApp(ctx: AppContext, token: string, rendererDir: string | null): Hono {
  const app = new Hono();

  const authorized = (c: Context): boolean => {
    const bearer = c.req.header('authorization');
    if (bearer?.startsWith('Bearer ') && timingSafeEqual(bearer.slice(7), token)) return true;
    const cookie = parseCookies(c.req.header('cookie'))[SESSION_COOKIE];
    return cookie !== undefined && timingSafeEqual(cookie, token);
  };

  // Token → cookie exchange on the first navigation of the window.
  app.use('*', async (c: Context, next: Next) => {
    const presented = c.req.query(TOKEN_QUERY);
    if (presented !== undefined && timingSafeEqual(presented, token)) {
      const url = new URL(c.req.url);
      url.searchParams.delete(TOKEN_QUERY);
      c.header('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      return c.redirect(`${url.pathname}${url.search}${url.hash}`, 302);
    }
    await next();
  });

  app.use('/api/*', async (c: Context, next: Next) => {
    if (!authorized(c)) {
      return c.json({ detail: 'Not authenticated', code: 'http_401', request_id: 'local' }, 401);
    }
    await next();
  });

  app.onError((error, c) => errorResponse(c, error));

  const api = new Hono();
  api.route('/auth', authRoutes(ctx));
  api.route('/', systemRoutes(ctx));
  api.route('/', leanSystemRoutes(ctx)); // GET /api/lean-versions
  api.route('/repositories', repositoryRoutes(ctx));
  api.route('/repositories', sourceRoutes(ctx));
  api.route('/repositories', blueprintRoutes(ctx));
  api.route('/repositories', gitRoutes(ctx));
  api.route('/repositories', leanRoutes(ctx));
  api.route('/repositories', pullRequestRoutes(ctx));
  api.route('/sessions', sessionRoutes(ctx));
  api.route('/internal', internalRoutes(ctx));
  app.route('/api', api);
  // Hono's `route()` copies a sub-app's routes but not its notFound handler,
  // so the JSON envelope for unknown API paths has to live on the parent:
  // without it a miss falls through to the SPA fallback below (200 text/html).
  app.all('/api/*', (c) => c.json({ detail: 'Not found', code: 'http_404', request_id: 'local' }, 404));

  // Static renderer with SPA fallback (BrowserRouter paths resolve to index.html).
  if (rendererDir) {
    const root = resolve(rendererDir);
    app.get('*', (c) => {
      // A malformed escape in a page path is just a page path: serve the SPA.
      let pathname = safeDecode(new URL(c.req.url).pathname) ?? '/';
      // electron-vite forces a relative base (./assets/x.js) in production,
      // so a deep BrowserRouter path such as /repo/o/r asks for
      // /repo/o/assets/x.js. Assets are one level deep, hence the *last*
      // segment: a repository or owner slug named "assets" must not match.
      const assets = pathname.lastIndexOf('/assets/');
      if (assets > 0) pathname = pathname.slice(assets);
      const candidate = normalize(join(root, pathname));
      const isFile = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile();
      const target = isFile ? candidate : join(root, 'index.html');
      if (!existsSync(target)) return c.text('Renderer not built', 500);
      const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      c.header('Content-Type', type);
      securityHeaders(c);
      if (!isFile || target.endsWith('index.html')) c.header('Cache-Control', 'no-store');
      const stream = createReadStream(target);
      return c.body(stream as unknown as ReadableStream);
    });
  }

  return app;
}

export async function startLocalServer(
  ctx: AppContext,
  options: { rendererDir: string | null; port?: number; token?: string },
): Promise<LocalServer> {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const app = buildApp(ctx, token, options.rendererDir);
  const server: ServerType = await new Promise((resolveServer, rejectServer) => {
    const started = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port ?? 0 }, () => {
      started.off('error', rejectServer);
      resolveServer(started);
    });
    // A fixed port that is already taken (EADDRINUSE) rejects instead of
    // surfacing as an unhandled 'error' event that kills the process.
    started.once('error', rejectServer);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    port,
    token,
    entryUrl: (path = '/') => {
      // Through the URL class so the token lands in the query even when the
      // path carries a fragment (`/repo/o/r/blueprint/x#3.2`); appended as
      // text it would end up inside the hash and never reach the server.
      const url = new URL(path, baseUrl);
      url.searchParams.set(TOKEN_QUERY, token);
      return url.toString();
    },
    close: () =>
      new Promise((resolveClose) => {
        // `Server.close` waits for in-flight responses, and an SSE subscriber
        // is one forever: end the streams and drop every connection so a
        // headless harness (or the app) can actually stop.
        ctx.blueprintRooms.closeAll();
        ctx.sessionRooms.closeAll();
        server.close(() => resolveClose());
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}
