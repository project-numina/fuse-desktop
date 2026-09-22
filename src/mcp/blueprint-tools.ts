import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FuseToolSchemas } from './tools';
import { coerceLabels, jsonResult, MUTATING, READ_ONLY, textResult, type FuseToolContext } from './tool-support';

const BLUEPRINT_TIMEOUT_MS = 120_000;
const REFRESH_TIMEOUT_MS = 300_000;

export interface UpdateResponse {
  blueprint: string;
  updated: string[];
  skipped: string[];
}

export interface StatusResponse {
  blueprint: string;
  target_status: string;
  updated: string[];
  normalized: string[];
  resolutions: string[];
  skipped: string[];
}

export interface RefreshResponse {
  blueprint: string;
  declarations: Array<{ label: string; kind: string; title: string }>;
}

/** Register tools that read and mutate parsed blueprint declarations. */
export function registerBlueprintTools(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  registerSummary(server, context, schemas);
  registerListDeclarations(server, context, schemas);
  registerReadDeclarations(server, context, schemas);
  registerUpdateDeclarations(server, context, schemas);
  registerSetStatus(server, context, schemas);
  registerValidation(server, context, schemas);
  registerRefresh(server, context, schemas);
}

function registerSummary(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_get_summary',
    {
      title: 'Blueprint Summary',
      description:
        'Return blueprint scalars plus a compact source-file outline. Each file entry includes its filename, \\chapter or \\section title, declaration count and status rollup. Pass that filename to blueprint_list_declarations(file=...) to enumerate labels from that source file.',
      inputSchema: schemas.blueprint_get_summary,
      annotations: READ_ONLY,
    },
    context.guarded('blueprint_get_summary', async () => {
      const result = await context.client.post<Record<string, unknown>>(`${context.internal}/blueprint/summary`, {}, {
        timeoutMs: BLUEPRINT_TIMEOUT_MS,
      });
      return jsonResult(result);
    }),
  );
}

function registerListDeclarations(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_list_declarations',
    {
      title: 'List Declarations',
      description:
        "List the blueprint's declarations, optionally scoped. The discovery step between blueprint_get_summary and blueprint_read_declarations. Filters combine, and every match carries label, kind, title, status and file. Empty results also report the available filter values.",
      inputSchema: schemas.blueprint_list_declarations,
      annotations: READ_ONLY,
    },
    context.guarded('blueprint_list_declarations', async (args: { file?: string; status?: string; kind?: string }) => {
      const body: Record<string, unknown> = {};
      if (args.file !== undefined) body.file = args.file;
      if (args.status !== undefined) body.status = args.status;
      if (args.kind !== undefined) body.kind = args.kind;
      const result = await context.client.post<Record<string, unknown>>(
        `${context.internal}/blueprint/declarations/list`,
        body,
        { timeoutMs: BLUEPRINT_TIMEOUT_MS },
      );
      return jsonResult(result);
    }),
  );
}

function registerReadDeclarations(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_read_declarations',
    {
      title: 'Read Declarations',
      description:
        'Read several declarations in one call, projected to chosen fields. Pass every label you care about at once. Each label is resolved by exact match and, as a fallback, by a unique Lean declaration name; misses are listed under not_found. Omit `fields` for the metadata-only default (label, kind, title, status, leanDeclaration, leanFile, uses, assessment), which excludes the large statement / proof text and relevantDeclarations; pass an explicit list such as ["statement", "proof", "relevantDeclarations"] to opt in. Unknown field names are listed under ignored_fields.',
      inputSchema: schemas.blueprint_read_declarations,
      annotations: READ_ONLY,
    },
    context.guarded('blueprint_read_declarations', async (args: { labels: string | string[]; fields?: string[] }) => {
      const body: Record<string, unknown> = { labels: coerceLabels(args.labels) };
      if (args.fields !== undefined) body.fields = args.fields;
      const result = await context.client.post<Record<string, unknown>>(
        `${context.internal}/blueprint/declarations/read`,
        body,
        { timeoutMs: BLUEPRINT_TIMEOUT_MS },
      );
      return jsonResult(result, 2);
    }),
  );
}

function registerUpdateDeclarations(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_update_declarations',
    {
      title: 'Update Declarations',
      description:
        'Apply agent-writable fields to several declarations in one call. Each entry is {"label": str, "fields": object}; writable fields are leanDeclaration, leanFile, assessment (null, IMPOSSIBLE or ALREADY_IN_MATHLIB), notes, issues (list of strings), scratchFile and relevantDeclarations (merged by name). Parser-owned fields are rejected and status must be set via blueprint_set_declaration_status so the .tex tags stay in sync. Entries that fail validation are skipped and reported; the rest still apply.',
      inputSchema: schemas.blueprint_update_declarations,
      annotations: MUTATING,
    },
    context.guarded('blueprint_update_declarations', async (args: {
      updates: Array<{ label: string; fields: Record<string, unknown> }>;
    }) => {
      const result = await context.client.post<UpdateResponse>(
        `${context.internal}/blueprint/declarations/update`,
        { updates: args.updates },
        { timeoutMs: BLUEPRINT_TIMEOUT_MS },
      );
      return textResult(formatUpdateSummary(result));
    }),
  );
}

function registerSetStatus(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_set_declaration_status',
    {
      title: 'Set Declaration Status',
      description:
        'Set the status of one or more declarations and sync the .tex tags. "proved": status proved; writes \\lean{} / \\uses{...} / statement \\leanok and, when the declaration has a proof block, a \\leanok inside it. "formalized": status in_progress; the same statement tags but no proof-block \\leanok (statement-only kinds are normalized to proved). "unformalized": status not_started; strips those tags. "proved" and "formalized" require leanDeclaration to already be set. Idempotent; labels may be a single label or a list (batch prover results in one call).',
      inputSchema: schemas.blueprint_set_declaration_status,
      annotations: MUTATING,
    },
    context.guarded('blueprint_set_declaration_status', async (args: {
      labels: string | string[];
      status: 'proved' | 'formalized' | 'unformalized';
    }) => {
      const result = await context.client.post<StatusResponse>(
        `${context.internal}/blueprint/declarations/status`,
        { labels: coerceLabels(args.labels), status: args.status },
        { timeoutMs: BLUEPRINT_TIMEOUT_MS },
      );
      return textResult(formatStatusSummary(result));
    }),
  );
}

function registerValidation(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_validate',
    {
      title: 'Validate Blueprint',
      description:
        'Run bounded structural and dependency-graph checks on the blueprint: duplicate labels, unknown \\uses targets, dependency cycles and unreadable includes. Returns JSON with ok, a coverage summary, per-check status and bounded issues with a stable code and a file:line location.',
      inputSchema: schemas.blueprint_validate,
      annotations: READ_ONLY,
    },
    context.guarded('blueprint_validate', async () => {
      const result = await context.client.post<Record<string, unknown>>(`${context.internal}/blueprint/validate`, {}, {
        timeoutMs: BLUEPRINT_TIMEOUT_MS,
      });
      return jsonResult(result, 2);
    }),
  );
}

function registerRefresh(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'blueprint_refresh',
    {
      title: 'Refresh Blueprint Metadata',
      description:
        'Re-parse the LaTeX blueprint and update declaration metadata. Call this after modifying the .tex files. Preserves agent-written fields (assessment, notes, issues, leanDeclaration, leanFile, scratchFile, relevantDeclarations) while updating parser-derived fields (kind, title, statement, proof, uses, status).',
      inputSchema: schemas.blueprint_refresh,
      annotations: MUTATING,
    },
    context.guarded('blueprint_refresh', async () => {
      const result = await context.client.post<RefreshResponse>(`${context.internal}/blueprint/refresh`, {}, {
        timeoutMs: REFRESH_TIMEOUT_MS,
      });
      return textResult(formatRefreshSummary(result));
    }),
  );
}

export function formatUpdateSummary(result: UpdateResponse): string {
  const parts: string[] = [];
  if (result.updated.length > 0) {
    parts.push(`Updated ${result.updated.length} declaration(s) in blueprint '${result.blueprint}': ${result.updated.join(', ')}.`);
  }
  if (result.skipped.length > 0) {
    parts.push(
      `Skipped ${result.skipped.length} (the rest were applied; fix and retry ONLY these, do not resend the whole batch): ${result.skipped.join('; ')}.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : 'Error: no declarations were updated.';
}

export function formatStatusSummary(result: StatusResponse): string {
  const parts: string[] = [];
  if (result.updated.length > 0) {
    parts.push(`Set status of ${result.updated.length} declaration(s) to '${result.target_status}': ${result.updated.join(', ')}.`);
  }
  if (result.normalized.length > 0) {
    parts.push(`Normalized 'formalized' -> terminal for statement-only declaration(s): ${result.normalized.join(', ')}.`);
  }
  if (result.resolutions.length > 0) {
    parts.push(`Resolved Lean names to labels: ${result.resolutions.join('; ')} (pass the blueprint label directly next time).`);
  }
  if (result.skipped.length > 0) parts.push(`Skipped: ${result.skipped.join('; ')}.`);
  if (parts.length === 0) return 'Error: no declarations were marked.';
  if (result.updated.length === 0 && result.skipped.length > 0) {
    return `No declarations marked. Skipped: ${result.skipped.join('; ')}.`;
  }
  return parts.join(' ');
}

export function formatRefreshSummary(result: RefreshResponse): string {
  if (result.declarations.length === 0) {
    return `Warning: no declarations found after re-parsing '${result.blueprint}'. Check the .tex file for valid leanblueprint environments with \\label commands.`;
  }
  const lines = [`Blueprint '${result.blueprint}': ${result.declarations.length} entries`];
  for (const row of result.declarations) lines.push(`  - ${row.label} (${row.kind}): ${row.title}`);
  return lines.join('\n');
}
