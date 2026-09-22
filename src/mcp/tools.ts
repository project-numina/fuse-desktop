/**
 * Public catalogue and registration entry point for the `fuse` MCP tools.
 * Tool names become `mcp__fuse__<name>`; schemas and descriptions retain the
 * web tooling vocabulary used by the agent role prompts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerBlueprintTools } from './blueprint-tools';
import { registerBuildTools } from './build-tools';
import { registerLeanTools } from './lean-tools';
import { createToolContext, type FuseToolDeps } from './tool-support';

export { formatRefreshSummary, formatStatusSummary, formatUpdateSummary } from './blueprint-tools';
export { MODULE_NAME } from './build-tools';
export { toolErrorResult } from './tool-support';
export type { FuseToolDeps } from './tool-support';

export const STATUS_VERBS = ['proved', 'formalized', 'unformalized'] as const;
export const LIST_STATUS_FILTERS = ['not_started', 'in_progress', 'proved', 'formalized', 'unformalized'] as const;

const filePath = z.string().describe('Path to a Lean file in the project');
const line = z.number().int().min(1).describe('Line number (1-indexed)');

/** Input schemas, exported so callers can validate arguments without a server. */
export const TOOL_SCHEMAS = {
  lean_goal: {
    file_path: filePath,
    line,
    column: z.number().int().min(1).optional().describe('Column (1-indexed). Omit to get before/after'),
  },
  lean_term_goal: {
    file_path: filePath,
    line,
    column: z.number().int().min(1).optional().describe('Column (defaults to end of line)'),
  },
  lean_hover: {
    file_path: filePath,
    line,
    column: z.number().int().min(1).describe('Column (1-indexed)'),
  },
  lean_diagnostic_messages: {
    file_path: filePath,
    start_line: z.number().int().min(1).optional().describe('Filter from line (1-indexed)'),
    end_line: z.number().int().min(1).optional().describe('Filter to line (1-indexed)'),
    declaration_name: z.string().optional().describe('Filter to a single declaration (its Lean name)'),
  },
  lean_reload_file: {
    file_path: filePath,
  },
  lean_loogle: {
    query: z.string().describe('Type pattern, constant, or name substring'),
    num_results: z.number().int().min(1).optional().describe('Max results (default 8)'),
  },
  lean_build: {
    target: z
      .string()
      .optional()
      .describe(
        "Lean module to build (e.g. 'Numina.Blueprints.Froda'), taken from an existing 'import' line; omit to build the whole project. Do not pass a file path.",
      ),
  },
  get_build_status: {},
  get_build_errors: {
    include_warnings: z.boolean().optional().describe('Also return the warning list (default false)'),
  },
  blueprint_get_summary: {},
  blueprint_list_declarations: {
    file: z.string().optional().describe('Restrict to declarations parsed from this .tex filename (as reported by blueprint_get_summary)'),
    status: z
      .enum(LIST_STATUS_FILTERS)
      .optional()
      .describe('Restrict to not_started, in_progress or proved (formalized/unformalized are accepted aliases)'),
    kind: z.string().optional().describe('Restrict to a declaration kind such as theorem or lemma'),
  },
  blueprint_read_declarations: {
    labels: z.union([z.string(), z.array(z.string())]).describe('A single declaration label or a list of labels'),
    fields: z
      .array(z.string())
      .optional()
      .describe('Field names to include per declaration; omit for the metadata-only default'),
  },
  blueprint_update_declarations: {
    updates: z
      .array(
        z.object({
          label: z.string().describe('Blueprint \\label of the declaration'),
          fields: z.record(z.string(), z.unknown()).describe('Agent-writable fields to merge into the declaration'),
        }),
      )
      .min(1)
      .describe('One {label, fields} entry per declaration'),
  },
  blueprint_set_declaration_status: {
    labels: z.union([z.string(), z.array(z.string())]).describe('A single declaration label or a list of labels'),
    status: z.enum(STATUS_VERBS).describe('One of "proved", "formalized", "unformalized"'),
  },
  blueprint_validate: {},
  blueprint_refresh: {},
} as const;

export type FuseToolSchemas = typeof TOOL_SCHEMAS;
export type ToolName = keyof FuseToolSchemas;

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

export function registerFuseTools(server: McpServer, deps: FuseToolDeps): void {
  const context = createToolContext(deps);
  registerLeanTools(server, context, TOOL_SCHEMAS);
  registerBuildTools(server, context, TOOL_SCHEMAS);
  registerBlueprintTools(server, context, TOOL_SCHEMAS);
}
