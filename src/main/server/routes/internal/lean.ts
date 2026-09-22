import type { Hono } from 'hono';
import type { GoalRequest } from '@shared/api-types';
import type { AppContext } from '../../context';
import { HttpError } from '../../errors';
import type { InternalPorts, LeanServiceLike, ScopedDiagnosticRequest, TermGoalResponse } from '.';
import {
  PROJECT_ROUTE,
  bad,
  blueprintService,
  leanService,
  optionalInt,
  readJsonBody,
  requireInt,
  requireString,
  str,
} from './helpers';

const LOOGLE_URL = 'https://loogle.lean-lang.org/json';
const LOOGLE_TIMEOUT_MS = 10_000;

export async function loogleRemote(query: string, numResults: number, fetchImpl: typeof fetch): Promise<{ items: Array<{ name: string; type: string; module: string }> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOGLE_TIMEOUT_MS);
  let payload: unknown;
  try {
    const response = await fetchImpl(`${LOOGLE_URL}?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'fuse-desktop/0.1', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch (error) {
    const message = controller.signal.aborted ? 'timed out' : error instanceof Error ? error.message : String(error);
    throw new HttpError(502, `loogle request failed: ${message}`, 'loogle_failed');
  } finally {
    clearTimeout(timer);
  }
  const hits = payload && typeof payload === 'object' ? (payload as { hits?: unknown }).hits : undefined;
  if (!Array.isArray(hits)) return { items: [] };
  return {
    items: hits.slice(0, numResults).map((hit) => {
      const record = hit && typeof hit === 'object' ? (hit as Record<string, unknown>) : {};
      return { name: str(record.name), type: str(record.type), module: str(record.module) };
    }),
  };
}

async function serviceLoogle(service: LeanServiceLike, query: string, numResults: number): Promise<{ items: unknown[] }> {
  try {
    const result = (await service.loogle?.(query, numResults)) as { items?: unknown };
    return { items: Array.isArray(result?.items) ? result.items.slice(0, numResults) : [] };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `loogle request failed: ${error instanceof Error ? error.message : String(error)}`, 'loogle_failed');
  }
}

export function registerInternalLeanRoutes(app: Hono, ctx: AppContext, fetchImpl: InternalPorts['fetch']): void {
  app.post('/loogle', async (c) => {
    const body = await readJsonBody(c);
    const query = str(body.query).trim();
    if (!query) throw bad("'query' must be a non-empty string.");
    const requested = Number(body.num_results);
    const numResults = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 8;
    const service = ctx.services.lean as LeanServiceLike | undefined;
    return c.json(service?.loogle ? await serviceLoogle(service, query, numResults) : await loogleRemote(query, numResults, fetchImpl));
  });

  app.post(`${PROJECT_ROUTE}/lean/term-goal`, async (c) => {
    const project = blueprintService(ctx).openProject(c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const body = await readJsonBody(c);
    const request: GoalRequest = { file_path: requireString(body, 'file_path'), line: requireInt(body, 'line', 1), column: optionalInt(body, 'column', 1) };
    const service = leanService(ctx);
    if (service.termGoal) {
      const result = await service.termGoal(project, request, c.req.raw.signal);
      return c.json({ line_context: result.line_context, expected_type: result.expected_type });
    }
    if (!service.goals) throw new HttpError(501, 'The Lean service does not implement term goals.', 'not_implemented');
    const goals = await service.goals(project, request, c.req.raw.signal);
    const tacticGoals = [goals.goals, goals.goals_before, goals.goals_after].some((list) => (list?.length ?? 0) > 0);
    const payload: TermGoalResponse & { note?: string } = { line_context: goals.line_context, expected_type: goals.expected_type };
    if (goals.expected_type === null && tacticGoals) payload.note = 'Tactic goals are active at this position; inspect them with lean_goal.';
    return c.json(payload);
  });

  app.post(`${PROJECT_ROUTE}/lean/diagnostics`, async (c) => {
    const project = blueprintService(ctx).openProject(c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const body = await readJsonBody(c);
    const service = leanService(ctx);
    if (!service.diagnostics) throw new HttpError(501, 'The Lean service does not implement live diagnostics.', 'not_implemented');
    const request: ScopedDiagnosticRequest = {
      file_path: requireString(body, 'file_path'),
      start_line: optionalInt(body, 'start_line', 1),
      end_line: optionalInt(body, 'end_line', 1),
    };
    const declarationName = typeof body.declaration_name === 'string' ? body.declaration_name.trim() : '';
    if (declarationName) request.declaration_name = declarationName;
    const result = await service.diagnostics(project, request, c.req.raw.signal);
    const items = result.items ?? [];
    const failedDependencies = result.failed_dependencies ?? [];
    const complete = result.complete ?? true;
    const success = typeof result.success === 'boolean' ? result.success : complete && !items.some((item) => item.severity === 'error') && failedDependencies.length === 0;
    return c.json({ success, complete, items, failed_dependencies: failedDependencies });
  });
}
