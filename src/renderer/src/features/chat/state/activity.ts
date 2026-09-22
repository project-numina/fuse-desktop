/**
 * Tool-call activity formatting and the path/phase helpers it relies on.
 *
 * `formatToolActivity` turns a raw tool name and input into the
 * `ActivityItem` the chat panel renders, deciding the display label, a short
 * summary, and whether the row should be hidden as internal metadata noise.
 */

import { isSubagentSpawnTool } from '@/features/chat/state/subagents';
import type { ActivityItem, ToolHistoryEvent } from '@/features/chat/state/types';

export const BUILD_DISPLAY_PHASES = new Set([
  'preparing',
  'cloning',
  'fetching',
  'linking_deps',
  'downloading_cache',
  'building',
]);
export const BUILD_SUBSTANTIVE_PHASES = new Set([
  'preparing',
  'cloning',
  'linking_deps',
  'downloading_cache',
  'building',
]);

/**
 * Returns true if the path points to internal metadata that
 * should be hidden from the user (JSON declaration files,
 * .metadata directory, blueprint.json).
 */
export function isMetadataPath(filePath: string): boolean {
  if (filePath.includes('.metadata/')) return true;
  if (filePath.includes('/declarations/') && filePath.endsWith('.json')) return true;
  if (filePath.endsWith('blueprint.json')) return true;
  return false;
}

/**
 * Simplifies a file path for display: extracts just the filename.
 */
export function displayPath(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export function formatToolActivity(
  tool: string,
  input: Record<string, unknown>,
  options: { insideSubagent?: boolean } = {},
): ActivityItem {
  const filePath = String(input.file_path || input.path || '');
  const shortPath = displayPath(filePath);
  const hidden = isMetadataPath(filePath);

  const base: Pick<ActivityItem, 'rawInput' | 'hidden'> = {
    rawInput: input,
    hidden,
  };

  if (tool === 'Read') return { tool: 'Read', summary: shortPath, ...base };
  if (tool === 'Edit' || tool === 'MultiEdit') return { tool: 'Edit', summary: shortPath, ...base };
  if (tool === 'Write') return { tool: 'Write', summary: shortPath, ...base };
  if (tool === 'Bash') {
    const command = String(input.command || '');
    // Hide ls/cat commands on metadata paths.
    const metaBash = command.includes('.metadata')
      || command.includes('/declarations/');
    const short = command.length > 80
      ? command.slice(0, 80) + '...'
      : command;
    return {
      tool: 'Bash',
      summary: short,
      ...base,
      hidden: hidden || metaBash,
    };
  }
  if (tool === 'Glob') return { tool: 'Glob', summary: String(input.pattern || ''), ...base };
  if (tool === 'Grep') return { tool: 'Grep', summary: String(input.pattern || ''), ...base };
  // Both spawn names render as one label, so downstream code only ever sees
  // 'Agent' here; callers that must distinguish the raw name read the event.
  if (isSubagentSpawnTool(tool)) {
    return { tool: 'Agent', summary: String(input.description || 'subagent'), ...base, hidden: false };
  }

  if (tool.startsWith('mcp__report-misuse__')) {
    return { tool: 'report-misuse', summary: '', ...base, hidden: true };
  }
  if (tool.startsWith('mcp__prover-tools__')) {
    const action = tool.replace('mcp__prover-tools__', '');
    return {
      tool: 'prover-tools',
      summary: action,
      ...base,
      // The top-level call is only an anchor for the richer prover batch card.
      // Inside a delegated orchestrator there is deliberately no nested batch
      // card, so the ordinary MCP row is the single visible representation.
      hidden: !options.insideSubagent,
    };
  }
  if (tool.startsWith('mcp__authoring-tools__')) {
    const action = tool.replace('mcp__authoring-tools__', '');
    return {
      tool: 'authoring-tools',
      summary: action,
      ...base,
      // Match delegated prover workflows: the parent tool row is the single
      // visible representation inside a delegated agent, while the top-level
      // call remains an invisible anchor for its richer synthetic cards.
      hidden: !options.insideSubagent,
    };
  }
  if (tool === 'ToolSearch') {
    return { tool: 'ToolSearch', summary: '', ...base, hidden: true };
  }
  if (tool.startsWith('mcp__lean-explore__')) {
    const action = tool.replace('mcp__lean-explore__', '');
    return { tool: 'lean-explore', summary: action, ...base, hidden: false };
  }
  if (tool.startsWith('mcp__lean-lsp__')) {
    const action = tool.replace('mcp__lean-lsp__', '');
    return { tool: 'lean-lsp', summary: action, ...base, hidden: false };
  }
  if (tool.startsWith('mcp__blueprint-tools__')) {
    const action = tool.replace('mcp__blueprint-tools__', '');
    return { tool: 'blueprint-tools', summary: action, ...base, hidden: false };
  }
  if (tool.startsWith('mcp__build-tools__')) {
    const action = tool.replace('mcp__build-tools__', '');
    return { tool: 'build-tools', summary: action, ...base, hidden: false };
  }
  if (tool.startsWith('mcp__pdf-tools__')) {
    const action = tool.replace('mcp__pdf-tools__', '');
    return { tool: 'pdf-tools', summary: action, ...base, hidden: false };
  }
  if (tool.startsWith('mcp__source-tools__')) {
    const action = tool.replace('mcp__source-tools__', '');
    return { tool: 'source-tools', summary: action, ...base, hidden: false };
  }
  if (tool.startsWith('mcp__leanstral__')) {
    const action = tool.replace('mcp__leanstral__', '');
    return { tool: 'leanstral', summary: action, ...base, hidden: false };
  }

  // MCP tool identifiers always use mcp__<server>__<action>. Keep the
  // server-specific cases above for their visibility rules, then normalize
  // every other MCP server here so newly added integrations never leak the
  // raw protocol identifier into the chat UI.
  const mcpMatch = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcpMatch) {
    const [, server, action] = mcpMatch;
    return { tool: server, summary: action, ...base, hidden: false };
  }

  return { tool, summary: '', ...base };
}

const BACKGROUND_LOG_FILE = 'background-log.md';

/**
 * True when a tool event writes to the agent's internal background progress
 * log. These writes are an implementation detail, so they're hidden from the
 * activity view (both live and reconstructed).
 */
export function isBackgroundLogWrite(event: ToolHistoryEvent): boolean {
  if (event.kind !== 'tool_call' || !event.tool || !event.input) return false;
  if (!['Write', 'Edit', 'MultiEdit'].includes(event.tool)) return false;
  const filePath = String(event.input.file_path || event.input.path || '');
  return displayPath(filePath) === BACKGROUND_LOG_FILE;
}
