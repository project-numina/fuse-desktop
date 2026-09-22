/**
 * Shared helpers for collapsing runs of identical tool calls into a single
 * counted row. Used by both the inline orchestrator log / expanded subagent
 * timeline (ChatPanel) and the collapsed subagent card preview (SubagentCard)
 * so a burst of repeated calls reads as one line with an `(N)` badge in every
 * place a tool-call list is shown.
 */
import type { ActivityItem } from '@/features/chat/state/types';

// Tools whose row is rendered from `rawInput` (file path, command, pattern)
// rather than the tool/summary text. Their display identity depends on the
// input, so two consecutive calls only coalesce when the input matches too.
const RAW_INPUT_RENDERED_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Grep',
  'Glob',
]);

// Tools rendered by SearchToolCall, whose row shows the action name plus the
// query extracted from the input. Their display identity is the query alone,
// so two consecutive calls coalesce when their rendered queries match — not
// when the full input matches, which would split rows that look identical
// (e.g. `get_source_code` calls, whose input has no rendered field at all).
const QUERY_RENDERED_TOOLS = new Set(['lean-explore', 'lean-lsp']);

/**
 * The query a SearchToolCall row renders for an MCP search tool call. Shared
 * with SearchToolCall so the coalescing key cannot drift from the display.
 */
export function extractSearchQuery(input: Record<string, unknown>): string {
  const query = input.query || input.name || input.declaration_name || '';
  return String(query);
}

/**
 * A stable key for what a tool-call row visually renders. Consecutive
 * activities sharing this key are collapsed into one counted row, so a burst
 * of identical calls (e.g. repeated `blueprint-tools get_declaration`)
 * reads as a single line with an `(N)` badge instead of a wall of duplicates.
 */
export function activityDisplayKey(activity: ActivityItem): string {
  const base = `${activity.tool} ${activity.summary ?? ''} ${activity.isError === true ? 'error' : 'ok'}`;
  if (RAW_INPUT_RENDERED_TOOLS.has(activity.tool)) {
    return `${base} ${JSON.stringify(activity.rawInput ?? {})}`;
  }
  if (QUERY_RENDERED_TOOLS.has(activity.tool)) {
    return `${base} ${extractSearchQuery(activity.rawInput ?? {})}`;
  }
  return base;
}

/** A run of consecutive identical-looking tool calls collapsed into one row. */
export interface ActivityCallGroup {
  activity: ActivityItem;
  count: number;
  key: string;
}

/**
 * Collapses consecutive activities sharing an `activityDisplayKey` into counted
 * groups, preserving order.
 */
export function coalesceActivityCalls(
  calls: ActivityItem[],
): ActivityCallGroup[] {
  const groups: ActivityCallGroup[] = [];
  calls.forEach((call, index) => {
    const last = groups[groups.length - 1];
    if (last && activityDisplayKey(last.activity) === activityDisplayKey(call)) {
      last.count += 1;
      return;
    }
    groups.push({
      activity: call,
      count: 1,
      key: call.toolUseId || `${activityDisplayKey(call)}-${index}`,
    });
  });
  return groups;
}
