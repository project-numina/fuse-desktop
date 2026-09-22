import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FuseApiClient } from '@mcp/client';
import { createFuseServer } from '@mcp/create-server';
import type { FuseEnv } from '@mcp/env';
import { formatRefreshSummary, formatStatusSummary, formatUpdateSummary, TOOL_NAMES, TOOL_SCHEMAS } from '@mcp/tools';

interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

const repoPath = resolve(sep === '/' ? '/repo' : 'C:\\repo');
const projectRoot = join(repoPath, 'lean');

const env: FuseEnv = {
  apiUrl: 'http://127.0.0.1:1',
  apiToken: 'secret-token',
  owner: 'local',
  repo: 'my repo',
  blueprint: 'bp',
  repoPath,
  projectRoot,
};

const LEAN_BASE = '/api/repositories/local/my%20repo/blueprints/bp';
const INTERNAL_BASE = '/api/internal/local/my%20repo/bp';

function makeFakeFetch(routes: Record<string, Route>, calls: RecordedCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[key.toLowerCase()] = value;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, headers, body });
    const route = routes[url.pathname];
    if (!route) {
      return new Response(JSON.stringify({ detail: 'Not found', code: 'http_404', request_id: 'x' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...(route.headers ?? {}) },
    });
  }) as typeof fetch;
}

async function connect(routes: Record<string, Route>, files: Record<string, string> = {}) {
  const calls: RecordedCall[] = [];
  const fetchImpl = makeFakeFetch(routes, calls);
  const server = createFuseServer({
    env,
    client: new FuseApiClient({ baseUrl: env.apiUrl, token: env.apiToken, fetch: fetchImpl }),
    readFile: (absolutePath) => files[absolutePath] ?? null,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((block) => block.text ?? '').join('');
}

describe('tool schemas', () => {
  it('exposes the sixteen tools the prompts refer to', () => {
    expect(TOOL_NAMES).toEqual([
      'lean_goal',
      'lean_term_goal',
      'lean_hover',
      'lean_diagnostic_messages',
      'lean_reload_file',
      'lean_loogle',
      'lean_build',
      'get_build_status',
      'get_build_errors',
      'blueprint_get_summary',
      'blueprint_list_declarations',
      'blueprint_read_declarations',
      'blueprint_update_declarations',
      'blueprint_set_declaration_status',
      'blueprint_validate',
      'blueprint_refresh',
    ]);
  });

  it('requires 1-indexed positive lines and columns', () => {
    const schema = z.object(TOOL_SCHEMAS.lean_goal);
    expect(schema.safeParse({ file_path: 'A.lean', line: 1 }).success).toBe(true);
    expect(schema.safeParse({ file_path: 'A.lean', line: 0 }).success).toBe(false);
    expect(schema.safeParse({ file_path: 'A.lean', line: 2, column: 0 }).success).toBe(false);
    expect(schema.safeParse({ file_path: 'A.lean', line: 2.5 }).success).toBe(false);
    expect(z.object(TOOL_SCHEMAS.lean_hover).safeParse({ file_path: 'A.lean', line: 1 }).success).toBe(false);
  });

  it('accepts a single label or a list, and only the three status verbs', () => {
    const schema = z.object(TOOL_SCHEMAS.blueprint_set_declaration_status);
    expect(schema.safeParse({ labels: 'thm:a', status: 'proved' }).success).toBe(true);
    expect(schema.safeParse({ labels: ['thm:a', 'lem:b'], status: 'formalized' }).success).toBe(true);
    expect(schema.safeParse({ labels: ['thm:a'], status: 'in_progress' }).success).toBe(false);
    expect(schema.safeParse({ labels: 7, status: 'proved' }).success).toBe(false);
  });

  it('validates update entries and list filters', () => {
    const updates = z.object(TOOL_SCHEMAS.blueprint_update_declarations);
    expect(updates.safeParse({ updates: [{ label: 'a', fields: { notes: 'x' } }] }).success).toBe(true);
    expect(updates.safeParse({ updates: [] }).success).toBe(false);
    expect(updates.safeParse({ updates: [{ label: 'a' }] }).success).toBe(false);
    const list = z.object(TOOL_SCHEMAS.blueprint_list_declarations);
    expect(list.safeParse({}).success).toBe(true);
    expect(list.safeParse({ status: 'formalized' }).success).toBe(true);
    expect(list.safeParse({ status: 'done' }).success).toBe(false);
  });
});

describe('fuse MCP server over an in-memory transport', () => {
  let connected: Awaited<ReturnType<typeof connect>> | null = null;

  beforeEach(() => {
    connected = null;
  });

  afterEach(async () => {
    await connected?.client.close();
    await connected?.server.close();
  });

  it('answers initialize and lists every tool with its schema', async () => {
    connected = await connect({});
    expect(connected.client.getServerVersion()).toEqual({ name: 'fuse', version: '0.1.0' });
    const { tools } = await connected.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    const goal = tools.find((tool) => tool.name === 'lean_goal')!;
    expect(goal.inputSchema.required).toEqual(['file_path', 'line']);
    expect(goal.title).toBe('Proof Goals');
    const status = tools.find((tool) => tool.name === 'blueprint_set_declaration_status')!;
    const properties = status.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(properties.status.enum).toEqual(['proved', 'formalized', 'unformalized']);
  });

  it('marks every tool read-only or non-destructive so Codex runs it under approval_policy=never', async () => {
    // MCP defaults destructiveHint to true; Codex refuses such tools when
    // approvals are off ("MCP tool call requires approval, but approval policy is never").
    connected = await connect({});
    const { tools } = await connected.client.listTools();
    const needingApproval = tools.filter((tool) => tool.annotations?.readOnlyHint !== true && tool.annotations?.destructiveHint !== false).map((tool) => tool.name);
    expect(needingApproval).toEqual([]);
    const reload = tools.find((tool) => tool.name === 'lean_reload_file')!;
    expect(reload.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  });

  it('sends the bearer token and calls the lean goals route with a repo-relative path', async () => {
    connected = await connect({
      [`${LEAN_BASE}/lean/goals`]: {
        body: { line_context: 'x', goals: ['⊢ True'], goals_before: null, goals_after: null, expected_type: null },
      },
    });
    const result = await connected.client.callTool({
      name: 'lean_goal',
      arguments: { file_path: join(projectRoot, 'Sample', 'Basic.lean'), line: 3, column: 5 },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ line_context: 'x', goals: ['⊢ True'], goals_before: null, goals_after: null });
    expect(connected.calls).toHaveLength(1);
    const call = connected.calls[0];
    expect(call.method).toBe('POST');
    expect(call.headers.authorization).toBe('Bearer secret-token');
    expect(call.body).toEqual({ file_path: 'lean/Sample/Basic.lean', line: 3, column: 5 });
  });

  it('treats relative paths as project-relative and omits an absent column', async () => {
    connected = await connect({
      [`${LEAN_BASE}/lean/goals`]: { body: { line_context: '', goals: null, goals_before: [], goals_after: [], expected_type: null } },
    });
    await connected.client.callTool({ name: 'lean_goal', arguments: { file_path: 'Sample/Basic.lean', line: 1 } });
    expect(connected.calls[0].body).toEqual({ file_path: 'lean/Sample/Basic.lean', line: 1 });
  });

  it('refuses files outside the Lean project without calling the app', async () => {
    connected = await connect({});
    const result = await connected.client.callTool({ name: 'lean_hover', arguments: { file_path: join(repoPath, 'other', 'X.lean'), line: 1, column: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Error executing tool lean_hover: File '${join(repoPath, 'other', 'X.lean')}' is outside the assigned Lean project.`);
    expect(connected.calls).toHaveLength(0);
  });

  it('asks the internal term-goal helper for the expected type and relays its note', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/lean/term-goal`]: { body: { line_context: 'exact foo _', expected_type: 'Nat' } },
    });
    const result = await connected.client.callTool({ name: 'lean_term_goal', arguments: { file_path: 'A.lean', line: 2, column: 11 } });
    expect(connected.calls[0].path).toBe(`${INTERNAL_BASE}/lean/term-goal`);
    expect(connected.calls[0].body).toEqual({ file_path: 'lean/A.lean', line: 2, column: 11 });
    expect(JSON.parse(textOf(result))).toEqual({ line_context: 'exact foo _', expected_type: 'Nat' });
    connected.calls.length = 0;
    await connected.client.close();
    await connected.server.close();
    connected = await connect({
      [`${INTERNAL_BASE}/lean/term-goal`]: { body: { line_context: 'ctx', expected_type: null, note: 'Tactic goals are active at this position; inspect them with lean_goal.' } },
    });
    const fallback = await connected.client.callTool({ name: 'lean_term_goal', arguments: { file_path: 'A.lean', line: 2 } });
    expect(connected.calls[0].body).toEqual({ file_path: 'lean/A.lean', line: 2 });
    const payload = JSON.parse(textOf(fallback));
    expect(payload.expected_type).toBeNull();
    expect(payload.note).toMatch(/lean_goal/);
  });

  it('scopes diagnostics to a declaration found in the source and reports success', async () => {
    const source = ['import Mathlib', '', 'namespace Foo', '', 'theorem bar : True := by', '  trivial', '', 'theorem baz : False := by', '  sorry', 'end Foo', ''].join('\n');
    connected = await connect(
      {
        [`${INTERNAL_BASE}/lean/diagnostics`]: {
          body: { items: [{ severity: 'warning', message: 'declaration uses sorry', line: 8, column: 9, end_line: null, end_column: null }], complete: true, failed_dependencies: [] },
        },
      },
      { [join(repoPath, 'lean', 'A.lean')]: source },
    );
    const result = await connected.client.callTool({ name: 'lean_diagnostic_messages', arguments: { file_path: 'A.lean', declaration_name: 'baz' } });
    expect(result.isError).toBeFalsy();
    // The name goes to the route (LSP document-symbol scope); the scanned
    // range is the fallback for a service that does not honour it.
    expect(connected.calls[0].path).toBe(`${INTERNAL_BASE}/lean/diagnostics`);
    expect(connected.calls[0].body).toEqual({ file_path: 'lean/A.lean', declaration_name: 'baz', start_line: 8, end_line: 9 });
    const payload = JSON.parse(textOf(result));
    expect(payload.success).toBe(true);
    expect(payload.complete).toBe(true);
    expect(payload.items).toHaveLength(1);
  });

  it('fails declaration-scoped diagnostics for an unknown declaration', async () => {
    connected = await connect({}, { [join(repoPath, 'lean', 'A.lean')]: 'theorem one : True := trivial\n' });
    const result = await connected.client.callTool({ name: 'lean_diagnostic_messages', arguments: { file_path: 'A.lean', declaration_name: 'two' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Error executing tool lean_diagnostic_messages: Declaration 'two' not found in file.");
    expect(connected.calls).toHaveLength(0);
  });

  it('marks diagnostics unsuccessful when errors are present and forwards line filters', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/lean/diagnostics`]: {
        body: { items: [{ severity: 'error', message: 'type mismatch', line: 4, column: 3, end_line: 4, end_column: 9 }], complete: false, failed_dependencies: ['B.lean'] },
      },
    });
    const result = await connected.client.callTool({ name: 'lean_diagnostic_messages', arguments: { file_path: 'A.lean', start_line: 2, end_line: 10 } });
    expect(connected.calls[0].body).toEqual({ file_path: 'lean/A.lean', start_line: 2, end_line: 10 });
    const payload = JSON.parse(textOf(result));
    expect(payload).toMatchObject({ success: false, complete: false, failed_dependencies: ['B.lean'] });
  });

  it('treats failed imports as a failure even when the file itself is clean, and trusts an explicit success flag', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/lean/diagnostics`]: { body: { items: [], complete: true, failed_dependencies: ['A.lean'] } },
    });
    const broken = await connected.client.callTool({ name: 'lean_diagnostic_messages', arguments: { file_path: 'B.lean' } });
    expect(JSON.parse(textOf(broken))).toEqual({ success: false, complete: true, items: [], failed_dependencies: ['A.lean'] });
    await connected.client.close();
    await connected.server.close();
    connected = await connect({
      [`${INTERNAL_BASE}/lean/diagnostics`]: { body: { success: false, items: [], complete: true, failed_dependencies: [] } },
    });
    const explicit = await connected.client.callTool({ name: 'lean_diagnostic_messages', arguments: { file_path: 'B.lean' } });
    expect(JSON.parse(textOf(explicit)).success).toBe(false);
  });

  it('turns the API error envelope into a tool error with the Retry-After hint', async () => {
    connected = await connect({
      [`${LEAN_BASE}/lean/goals`]: {
        status: 409,
        headers: { 'retry-after': '2' },
        body: { detail: 'Lean is still processing this file. Please retry shortly.', code: 'lean_query_retry', request_id: 'r' },
      },
    });
    const result = await connected.client.callTool({ name: 'lean_goal', arguments: { file_path: 'A.lean', line: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error executing tool lean_goal: Lean is still processing this file. Please retry shortly. Retry in 2s.');
  });

  it('reloads files and searches loogle through the app', async () => {
    connected = await connect({
      [`${LEAN_BASE}/lean/reload`]: { body: { ok: true } },
      '/api/internal/loogle': { body: { items: [{ name: 'Nat.add_comm', type: '∀ (n m : ℕ), n + m = m + n', module: 'Init.Core' }] } },
    });
    const reload = await connected.client.callTool({ name: 'lean_reload_file', arguments: { file_path: 'A.lean' } });
    expect(JSON.parse(textOf(reload))).toEqual({ ok: true });
    const loogle = await connected.client.callTool({ name: 'lean_loogle', arguments: { query: 'Nat.add_comm' } });
    expect(connected.calls[1].body).toEqual({ query: 'Nat.add_comm', num_results: 8 });
    expect(JSON.parse(textOf(loogle)).items[0].name).toBe('Nat.add_comm');
  });

  it('builds a module through the internal build route and summarises diagnostics', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/build`]: {
        body: {
          status: 'failed',
          message: 'Build finished with 1 error(s)',
          exit_code: 1,
          errors: [{ file: 'Sample/Basic.lean', line: 3, column: 1, severity: 'error', message: 'oops' }],
          warnings: [],
          unscoped_errors: [],
          built_modules: ['Sample.Basic'],
        },
      },
    });
    const result = await connected.client.callTool({ name: 'lean_build', arguments: { target: 'Sample.Basic' } });
    expect(connected.calls[0].path).toBe(`${INTERNAL_BASE}/build`);
    expect(connected.calls[0].body).toEqual({ target: 'Sample.Basic' });
    const payload = JSON.parse(textOf(result));
    expect(payload).toMatchObject({ success: false, status: 'failed', error_count: 1, warning_count: 0, built_modules: ['Sample.Basic'] });
    expect(payload.errors[0].message).toBe('oops');
  });

  it('rejects an invalid module target before contacting the app', async () => {
    connected = await connect({});
    const result = await connected.client.callTool({ name: 'lean_build', arguments: { target: 'Sample/Basic.lean' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("invalid module name 'Sample/Basic.lean'");
    expect(connected.calls).toHaveLength(0);
  });

  it('builds the whole project when no target is given', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/build`]: { body: { status: 'succeeded', message: 'Build complete', exit_code: 0, errors: [], warnings: [], unscoped_errors: [] } },
    });
    const result = await connected.client.callTool({ name: 'lean_build', arguments: {} });
    expect(connected.calls[0].body).toEqual({});
    expect(JSON.parse(textOf(result))).toMatchObject({ success: true, status: 'succeeded' });
  });

  it('fetches build status and errors', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/build/status`]: { body: { status: 'done', running: false, error_count: 0 } },
      [`${INTERNAL_BASE}/build/errors`]: { body: { errors: [{ file: 'A.lean', line: 1, column: 1, severity: 'error', message: 'e' }], warnings: [{ file: 'A.lean', line: 2, column: 1, severity: 'warning', message: 'w' }] } },
    });
    const status = await connected.client.callTool({ name: 'get_build_status', arguments: {} });
    expect(JSON.parse(textOf(status))).toMatchObject({ status: 'done', running: false });
    const errors = await connected.client.callTool({ name: 'get_build_errors', arguments: {} });
    expect(JSON.parse(textOf(errors))).toEqual({ errors: [{ file: 'A.lean', line: 1, column: 1, severity: 'error', message: 'e' }], warning_count: 1 });
    const withWarnings = await connected.client.callTool({ name: 'get_build_errors', arguments: { include_warnings: true } });
    expect(JSON.parse(textOf(withWarnings)).warnings).toHaveLength(1);
  });

  it('reads declarations with coerced labels and explicit fields', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/blueprint/declarations/read`]: {
        body: { declarations: { 'thm:a': { label: 'thm:a', statement: 'S' } }, not_found: ['thm:zzz'], ignored_fields: ['bogus'] },
      },
    });
    const result = await connected.client.callTool({
      name: 'blueprint_read_declarations',
      arguments: { labels: 'thm:a', fields: ['statement', 'bogus'] },
    });
    expect(connected.calls[0].body).toEqual({ labels: ['thm:a'], fields: ['statement', 'bogus'] });
    const payload = JSON.parse(textOf(result));
    expect(payload.not_found).toEqual(['thm:zzz']);
    expect(payload.ignored_fields).toEqual(['bogus']);
  });

  it('passes list filters through and returns the compact summary', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/blueprint/declarations/list`]: { body: { filters: { file: null, status: 'in_progress', kind: null }, count: 0, declarations: [], available: { files: [], statuses: [], kinds: [] } } },
      [`${INTERNAL_BASE}/blueprint/summary`]: { body: { name: 'bp', declaration_count: 2 } },
    });
    await connected.client.callTool({ name: 'blueprint_list_declarations', arguments: { status: 'in_progress' } });
    expect(connected.calls[0].body).toEqual({ status: 'in_progress' });
    const summary = await connected.client.callTool({ name: 'blueprint_get_summary', arguments: {} });
    expect(textOf(summary)).toBe('{"name":"bp","declaration_count":2}');
  });

  it('formats update, status and refresh summaries in the web wording', async () => {
    connected = await connect({
      [`${INTERNAL_BASE}/blueprint/declarations/update`]: { body: { blueprint: 'bp', updated: ['thm:a', 'lem:b'], skipped: ["thm:c (Error: 'issues' must be a list of strings.)"] } },
      [`${INTERNAL_BASE}/blueprint/declarations/status`]: {
        body: { blueprint: 'bp', target_status: 'in_progress', updated: ['def:x', 'thm:a'], normalized: ['def:x'], resolutions: ["'Foo.a' -> 'thm:a'"], skipped: ['lem:b (no leanDeclaration; run formalizer)'] },
      },
      [`${INTERNAL_BASE}/blueprint/refresh`]: { body: { blueprint: 'bp', declarations: [{ label: 'thm:a', kind: 'theorem', title: 'Main' }] } },
    });
    const update = await connected.client.callTool({
      name: 'blueprint_update_declarations',
      arguments: { updates: [{ label: 'thm:a', fields: { leanDeclaration: 'Foo.a' } }] },
    });
    expect(textOf(update)).toBe(
      "Updated 2 declaration(s) in blueprint 'bp': thm:a, lem:b. Skipped 1 (the rest were applied; fix and retry ONLY these, do not resend the whole batch): thm:c (Error: 'issues' must be a list of strings.).",
    );
    const status = await connected.client.callTool({ name: 'blueprint_set_declaration_status', arguments: { labels: ['Foo.a', 'def:x', 'lem:b'], status: 'formalized' } });
    expect(connected.calls[1].body).toEqual({ labels: ['Foo.a', 'def:x', 'lem:b'], status: 'formalized' });
    expect(textOf(status)).toBe(
      "Set status of 2 declaration(s) to 'in_progress': def:x, thm:a. Normalized 'formalized' -> terminal for statement-only declaration(s): def:x. Resolved Lean names to labels: 'Foo.a' -> 'thm:a' (pass the blueprint label directly next time). Skipped: lem:b (no leanDeclaration; run formalizer).",
    );
    const refresh = await connected.client.callTool({ name: 'blueprint_refresh', arguments: {} });
    expect(textOf(refresh)).toBe("Blueprint 'bp': 1 entries\n  - thm:a (theorem): Main");
  });

  it('rejects arguments that fail the schema before any HTTP call', async () => {
    connected = await connect({});
    const result = await connected.client.callTool({ name: 'lean_goal', arguments: { file_path: 'A.lean', line: 0 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid arguments for tool lean_goal/);
    expect(connected.calls).toHaveLength(0);
  });
});

describe('summary formatting helpers', () => {
  it('reports skipped-only status updates as "No declarations marked"', () => {
    expect(formatStatusSummary({ blueprint: 'bp', target_status: 'proved', updated: [], normalized: [], resolutions: [], skipped: ['x (bad)'] })).toBe('No declarations marked. Skipped: x (bad).');
    expect(formatStatusSummary({ blueprint: 'bp', target_status: 'proved', updated: [], normalized: [], resolutions: [], skipped: [] })).toBe('Error: no declarations were marked.');
  });

  it('reports empty updates and empty refreshes', () => {
    expect(formatUpdateSummary({ blueprint: 'bp', updated: [], skipped: [] })).toBe('Error: no declarations were updated.');
    expect(formatRefreshSummary({ blueprint: 'bp', declarations: [] })).toMatch(/^Warning: no declarations found after re-parsing 'bp'/);
  });
});
