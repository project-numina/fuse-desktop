/**
 * `/api/sessions/*`: the agent session routes of the web backend, served by
 * the local `SessionService`. Paths, bodies, status codes and error texts
 * follow `api/sessions/{live,runtime,history}.py`; the desktop adds
 * `POST /:id/permissions/:requestId` for the CLI permission prompts.
 */

import { Hono, type Context } from 'hono';
import type { PermissionDecision } from '@shared/agent-events';
import type { MessageCreate, SessionCreate, SessionWaitRequest } from '@shared/api-types';
import { SessionService } from '../../services/sessions';
import type { AppContext } from '../context';
import { HttpError } from '../errors';

async function jsonBody<T>(c: Context): Promise<T> {
  const raw = await c.req.text();
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(422, 'Request body must be valid JSON.', 'validation_error');
  }
}

function intQuery(c: Context, name: string, fallback: number, min: number, max: number): number {
  const raw = c.req.query(name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(422, `${name} must be an integer between ${min} and ${max}.`, 'validation_error');
  }
  return value;
}

export function sessionRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  // The service registers itself in ctx.services; the integrator may create
  // it earlier with options, otherwise it is created here at mount time so
  // its startup reconciliation (conversations left running by a previous
  // process) happens at boot, before the dashboard reads them.
  const service = (): SessionService => (ctx.services.sessions as SessionService | undefined) ?? new SessionService(ctx);
  service();

  app.post('/', async (c) => {
    const body = await jsonBody<SessionCreate>(c);
    return c.json(await service().createSession(body));
  });

  app.get('/active', (c) => c.json(service().activeSessions()));
  app.get('/attention', (c) => c.json(service().attentionState()));
  app.post('/history/:conversationId/seen', async (c) => {
    const body = await jsonBody<{ revision?: string }>(c);
    if (typeof body.revision !== 'string' || !body.revision) throw new HttpError(422, 'revision is required', 'validation_error');
    service().markSeen(c.req.param('conversationId'), body.revision);
    return c.body(null, 204);
  });

  // ── History ────────────────────────────────────────────────────────────

  app.get('/history', async (c) => {
    const owner = c.req.query('repository_owner');
    const repo = c.req.query('repository_name');
    const blueprint = c.req.query('blueprint_name');
    if (!owner || !repo || !blueprint) {
      throw new HttpError(422, 'repository_owner, repository_name and blueprint_name are required.', 'validation_error');
    }
    return c.json(await service().listHistory(owner, repo, blueprint, intQuery(c, 'limit', 20, 1, 50), intQuery(c, 'offset', 0, 0, Number.MAX_SAFE_INTEGER), c.req.query('refresh_native') !== 'false'));
  });

  app.get('/history/native-status', (c) => {
    const owner = c.req.query('repository_owner') ?? '';
    const repo = c.req.query('repository_name') ?? '';
    const blueprint = c.req.query('blueprint_name') ?? '';
    return c.json({ warnings: service().nativeHistoryWarnings(owner, repo, blueprint), refreshing: service().nativeHistoryRefreshing(owner, repo, blueprint) });
  });

  app.get('/history/recent', (c) =>
    c.json(service().recentConversations(intQuery(c, 'limit', 20, 1, 50), intQuery(c, 'offset', 0, 0, Number.MAX_SAFE_INTEGER))),
  );

  app.get('/history/:conversationId', async (c) => c.json(await service().historyDetail(c.req.param('conversationId'))));

  app.get('/history/:conversationId/live', (c) => c.json(service().liveForConversation(c.req.param('conversationId'))));

  app.get('/history/:conversationId/subagents/:parentToolUseId', async (c) =>
    c.json(await service().subagentHistory(c.req.param('conversationId'), c.req.param('parentToolUseId'))),
  );

  app.post('/history/:conversationId/review-background', async (c) => c.json(await service().reviewBackground(c.req.param('conversationId'))));

  app.delete('/history/:conversationId/pending-resume', (c) => c.json(service().discardPendingResume(c.req.param('conversationId'))));

  app.delete('/history/:conversationId', async (c) => {
    await service().deleteHistory(c.req.param('conversationId'));
    return c.body(null, 204);
  });

  // Sharing needs the hosted service; the UI's share button gets a 404.
  app.post('/history/:conversationId/share', () => {
    throw new HttpError(404, 'Sharing is not available in Fuse Desktop.', 'http_404');
  });
  app.get('/history/share/:shareId', () => {
    throw new HttpError(404, 'Shared chat not found', 'http_404');
  });

  // ── Live session ───────────────────────────────────────────────────────

  app.get('/:sessionId/events', (c) => service().eventsResponse(c, c.req.param('sessionId')));

  app.post('/:sessionId/keepalive', (c) => {
    service().keepalive(c.req.param('sessionId'));
    return c.body(null, 204);
  });

  app.post('/:sessionId/messages', async (c) => {
    const body = await jsonBody<MessageCreate>(c);
    return c.json(await service().sendMessage(c.req.param('sessionId'), body));
  });

  app.post('/:sessionId/cancel', async (c) => c.json(await service().cancel(c.req.param('sessionId'))));

  app.post('/:sessionId/api-key-fallback', (c) => {
    service().state(c.req.param('sessionId'));
    throw new HttpError(409, 'This session is not waiting on an API billing decision.', 'http_409');
  });

  app.get('/:sessionId/state', (c) => c.json(service().state(c.req.param('sessionId'))));

  app.post('/:sessionId/wait', async (c) => {
    const body = await jsonBody<SessionWaitRequest | null>(c);
    return c.json(await service().wait(c.req.param('sessionId'), body?.timeout_seconds ?? null));
  });

  app.post('/:sessionId/permissions/:requestId', async (c) => {
    const body = await jsonBody<Partial<PermissionDecision>>(c);
    if (body.behavior !== 'allow' && body.behavior !== 'deny') {
      throw new HttpError(422, "behavior must be 'allow' or 'deny'.", 'validation_error');
    }
    const decision: PermissionDecision = { behavior: body.behavior };
    if (typeof body.message === 'string') decision.message = body.message;
    if (body.suggestion !== undefined) decision.suggestion = body.suggestion;
    await service().respondPermission(c.req.param('sessionId'), c.req.param('requestId'), decision);
    return c.json({ status: 'ok' });
  });

  return app;
}
