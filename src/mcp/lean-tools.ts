import { resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FuseToolSchemas } from './tools';
import { findDeclarationRange, toRepoRelativeLeanPath } from './paths';
import { jsonResult, MUTATING, READ_ONLY, type FuseToolContext } from './tool-support';

const LSP_TIMEOUT_MS = 120_000;
const DIAGNOSTICS_TIMEOUT_MS = 330_000;
const LOOGLE_TIMEOUT_MS = 20_000;

interface GoalResponse {
  line_context: string | null;
  goals: string[] | null;
  goals_before: string[] | null;
  goals_after: string[] | null;
  expected_type: string | null;
}

interface TermGoalResponse {
  line_context: string | null;
  expected_type: string | null;
  note?: string;
}

interface DiagnosticResponse {
  items: Array<{ severity: string }>;
  complete: boolean;
  failed_dependencies: string[];
  success?: boolean;
}

interface PositionArgs {
  file_path: string;
  line: number;
  column?: number;
}

interface DiagnosticArgs {
  file_path: string;
  start_line?: number;
  end_line?: number;
  declaration_name?: string;
}

/** Register tools backed by the app's shared Lean language-server session. */
export function registerLeanTools(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  registerGoal(server, context, schemas);
  registerTermGoal(server, context, schemas);
  registerHover(server, context, schemas);
  registerDiagnostics(server, context, schemas);
  registerReload(server, context, schemas);
  registerLoogle(server, context, schemas);
}

function registerGoal(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_goal',
    {
      title: 'Proof Goals',
      description: 'Proof goals at a position. Omit `column` for goals_before / goals_after.',
      inputSchema: schemas.lean_goal,
      annotations: READ_ONLY,
    },
    context.guarded('lean_goal', async (args: PositionArgs) => {
      const body = positionBody(args, context);
      const result = await context.client.post<GoalResponse>(`${context.leanBase}/lean/goals`, body, { timeoutMs: LSP_TIMEOUT_MS });
      return jsonResult(goalPayload(result), 2);
    }),
  );
}

function goalPayload(result: GoalResponse): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    line_context: result.line_context ?? '',
    goals: result.goals ?? null,
    goals_before: result.goals_before ?? null,
    goals_after: result.goals_after ?? null,
  };
  if (result.expected_type) payload.expected_type = result.expected_type;
  return payload;
}

function registerTermGoal(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_term_goal',
    {
      title: 'Term Goal',
      description: 'Expected type at a position (term-mode goal).',
      inputSchema: schemas.lean_term_goal,
      annotations: READ_ONLY,
    },
    context.guarded('lean_term_goal', async (args: PositionArgs) => {
      const result = await context.client.post<TermGoalResponse>(
        `${context.internal}/lean/term-goal`,
        positionBody(args, context),
        { timeoutMs: LSP_TIMEOUT_MS },
      );
      const payload: Record<string, unknown> = {
        line_context: result.line_context ?? '',
        expected_type: result.expected_type ?? null,
      };
      if (result.note) payload.note = result.note;
      return jsonResult(payload, 2);
    }),
  );
}

function registerHover(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_hover',
    {
      title: 'Hover',
      description: 'Hover information at a position (signature, docstring, module).',
      inputSchema: schemas.lean_hover,
      annotations: READ_ONLY,
    },
    context.guarded('lean_hover', async (args: PositionArgs & { column: number }) => {
      const result = await context.client.post<Record<string, unknown>>(
        `${context.leanBase}/lean/hover`,
        positionBody(args, context),
        { timeoutMs: LSP_TIMEOUT_MS },
      );
      return jsonResult(result, 2);
    }),
  );
}

function registerDiagnostics(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_diagnostic_messages',
    {
      title: 'Diagnostics',
      description:
        'Compiler diagnostics for a Lean file, optionally narrowed to a line range or to one declaration (`declaration_name`). Talks to the live Lean server; a full-file result also refreshes the error badges in the app.',
      inputSchema: schemas.lean_diagnostic_messages,
      annotations: READ_ONLY,
    },
    context.guarded('lean_diagnostic_messages', async (args: DiagnosticArgs) => {
      const body = diagnosticBody(args, context);
      const result = await context.client.post<DiagnosticResponse>(`${context.internal}/lean/diagnostics`, body, {
        timeoutMs: DIAGNOSTICS_TIMEOUT_MS,
      });
      return jsonResult(diagnosticPayload(result), 2);
    }),
  );
}

function diagnosticBody(args: DiagnosticArgs, context: FuseToolContext): Record<string, unknown> {
  const filePath = toRepoRelativeLeanPath(args.file_path, context.env);
  const body: Record<string, unknown> = { file_path: filePath };
  const declarationName = args.declaration_name?.trim();
  if (!declarationName) {
    if (args.start_line !== undefined) body.start_line = args.start_line;
    if (args.end_line !== undefined) body.end_line = args.end_line;
    return body;
  }
  // The route uses LSP document symbols; the text range is a compatibility
  // fallback for a service version that does not honor declaration_name yet.
  body.declaration_name = declarationName;
  const source = context.readFile(resolve(context.env.repoPath, filePath));
  if (source === null) throw new Error(`File '${args.file_path}' could not be read.`);
  const range = findDeclarationRange(source, declarationName);
  if (!range) throw new Error(`Declaration '${declarationName}' not found in file.`);
  body.start_line = range.startLine;
  body.end_line = range.endLine;
  return body;
}

function diagnosticPayload(result: DiagnosticResponse): Record<string, unknown> {
  const items = result.items ?? [];
  const complete = result.complete ?? true;
  const failedDependencies = result.failed_dependencies ?? [];
  const hasErrors = items.some((item) => item.severity === 'error') || failedDependencies.length > 0;
  return {
    success: typeof result.success === 'boolean' ? result.success : complete && !hasErrors,
    complete,
    items,
    failed_dependencies: failedDependencies,
  };
}

function registerReload(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_reload_file',
    {
      title: 'Reload File',
      description:
        "Close and reopen a file so the LSP re-elaborates it. Forces a fresh elaboration that picks up edits to the file's imported dependencies (the editor's \"Restart File\").",
      inputSchema: schemas.lean_reload_file,
      annotations: MUTATING,
    },
    context.guarded('lean_reload_file', async (args: { file_path: string }) => {
      const file_path = toRepoRelativeLeanPath(args.file_path, context.env);
      const result = await context.client.post<{ ok: boolean }>(`${context.leanBase}/lean/reload`, { file_path }, { timeoutMs: LSP_TIMEOUT_MS });
      return jsonResult({ ok: result?.ok ?? true });
    }),
  );
}

function registerLoogle(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_loogle',
    {
      title: 'Loogle',
      description: 'Search Mathlib by type signature via loogle.lean-lang.org.',
      inputSchema: schemas.lean_loogle,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    context.guarded('lean_loogle', async (args: { query: string; num_results?: number }) => {
      const result = await context.client.post<{ items: unknown[] }>(
        '/api/internal/loogle',
        { query: args.query, num_results: args.num_results ?? 8 },
        { timeoutMs: LOOGLE_TIMEOUT_MS },
      );
      return jsonResult({ items: result.items ?? [] }, 2);
    }),
  );
}

function positionBody(args: PositionArgs, context: FuseToolContext): Record<string, unknown> {
  const body: Record<string, unknown> = {
    file_path: toRepoRelativeLeanPath(args.file_path, context.env),
    line: args.line,
  };
  if (args.column !== undefined) body.column = args.column;
  return body;
}
