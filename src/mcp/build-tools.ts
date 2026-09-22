import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FuseToolSchemas } from './tools';
import { jsonResult, MUTATING, READ_ONLY, type FuseToolContext } from './tool-support';

const BUILD_TIMEOUT_MS = 1_200_000;
const QUERY_TIMEOUT_MS = 120_000;
const MAX_WARNINGS_IN_BUILD_RESULT = 100;

/** Lean module names, matching the app's build route validation. */
export const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_']*(\.[A-Za-z_][A-Za-z0-9_']*)*$/;

interface BuildResponse {
  status: string;
  message: string;
  exit_code: number | null;
  errors: unknown[];
  warnings: unknown[];
  unscoped_errors: string[];
  built_modules?: string[];
}

/** Register project build and persisted build-state tools. */
export function registerBuildTools(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  registerBuild(server, context, schemas);
  registerBuildStatus(server, context, schemas);
  registerBuildErrors(server, context, schemas);
}

function registerBuild(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'lean_build',
    {
      title: 'Build Project',
      description:
        'Run `lake build` for the whole project, or `lake build <target>` for one module, through the app so the build shows in the UI and its structured diagnostics also update the file tree. Returns when the build finishes, with the parsed errors and warnings. Concurrent calls are coalesced behind one build lock.',
      inputSchema: schemas.lean_build,
      annotations: MUTATING,
    },
    context.guarded('lean_build', async (args: { target?: string }) => {
      const target = args.target?.trim();
      validateBuildTarget(target);
      const result = await context.client.post<BuildResponse>(
        `${context.internal}/build`,
        target ? { target } : {},
        { timeoutMs: BUILD_TIMEOUT_MS },
      );
      return jsonResult(buildPayload(result), 2);
    }),
  );
}

function validateBuildTarget(target: string | undefined): void {
  if (target && !MODULE_NAME.test(target)) {
    throw new Error(`invalid module name '${target}'. Expected a dotted Lean module identifier (e.g. 'Numina.Blueprints.Froda').`);
  }
}

function buildPayload(result: BuildResponse): Record<string, unknown> {
  const warnings = result.warnings ?? [];
  const payload: Record<string, unknown> = {
    success: result.status === 'succeeded',
    status: result.status,
    message: result.message,
    error_count: (result.errors ?? []).length + (result.unscoped_errors ?? []).length,
    warning_count: warnings.length,
    errors: result.errors ?? [],
    unscoped_errors: result.unscoped_errors ?? [],
    warnings: warnings.slice(0, MAX_WARNINGS_IN_BUILD_RESULT),
  };
  if (warnings.length > MAX_WARNINGS_IN_BUILD_RESULT) {
    payload.warnings_truncated = `${warnings.length - MAX_WARNINGS_IN_BUILD_RESULT} more warning(s) omitted; call get_build_errors with include_warnings for the full list.`;
  }
  if (result.built_modules?.length) payload.built_modules = result.built_modules;
  return payload;
}

function registerBuildStatus(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'get_build_status',
    {
      title: 'Build Status',
      description:
        "The app's current build state: whether a build is running, its recent phases, the persisted outcome of the last build, and per-file error counts.",
      inputSchema: schemas.get_build_status,
      annotations: READ_ONLY,
    },
    context.guarded('get_build_status', async () => {
      const result = await context.client.post<Record<string, unknown>>(`${context.internal}/build/status`, {}, {
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      return jsonResult(result, 2);
    }),
  );
}

function registerBuildErrors(server: McpServer, context: FuseToolContext, schemas: FuseToolSchemas): void {
  server.registerTool(
    'get_build_errors',
    {
      title: 'Build Errors',
      description:
        'The full error list from the last build or full-file diagnostics run, as recorded in the app (file, line, column, message). Pass include_warnings for the warning list too.',
      inputSchema: schemas.get_build_errors,
      annotations: READ_ONLY,
    },
    context.guarded('get_build_errors', async (args: { include_warnings?: boolean }) => {
      const result = await context.client.post<{ errors: unknown[]; warnings: unknown[] }>(
        `${context.internal}/build/errors`,
        {},
        { timeoutMs: QUERY_TIMEOUT_MS },
      );
      const payload: Record<string, unknown> = {
        errors: result.errors ?? [],
        warning_count: (result.warnings ?? []).length,
      };
      if (args.include_warnings) payload.warnings = result.warnings ?? [];
      return jsonResult(payload, 2);
    }),
  );
}
