/**
 * Shrinking tool payloads to what the chat UI can actually render.
 *
 * Tool inputs and results reach the frontend over SSE and are persisted
 * into the transcript, so an unbounded `Write` body or a megabyte of tool
 * output would bloat both. These helpers truncate to per-field budgets
 * chosen from what the UI does with each field: edit/write content gets
 * enough room for an inline diff, a Bash command gets enough for a
 * realistic one-liner rendered verbatim, and path-valued fields truncate
 * from the *front* so the basename the UI displays survives.
 */

// Tool-input keys that hold filesystem paths. When truncated these keep their
// tail so the basename (what the UI renders) survives long absolute paths.
const PATH_INPUT_KEYS = new Set(['file_path', 'path', 'notebook_path']);
export const TOOL_DISPLAY_METADATA_KEY = '_fuse_display';

const DEFAULT_MAX = 200;
const RICH_TEXT_MAX = 5000;
// The UI renders a Bash command verbatim in a horizontally scrollable row,
// so this limit is the only thing bounding how much of it a user can read.
// Keep it well above any realistic one-liner.
const COMMAND_MAX = 2000;
const RESULT_MAX = 500;

/** Match frontend source-preview line counting for tool call stats. */
export function countDisplayLines(value: string): number {
  if (!value) return 0;
  const trimmed = value.endsWith('\n') ? value.slice(0, -1) : value;
  return trimmed.split('\n').length;
}

/**
 * Truncate tool-input strings to keep SSE payloads small. Edit/MultiEdit/
 * Write get a higher limit so the frontend can render meaningful diffs.
 */
export function summarizeToolInput(toolName: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const lineCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(toolInput)) {
    if (typeof value !== 'string') {
      summary[key] = value;
      continue;
    }
    const isRichText =
      ((toolName === 'Edit' || toolName === 'MultiEdit') && (key === 'old_string' || key === 'new_string')) ||
      (toolName === 'Write' && key === 'content');
    const isBashCommand = toolName === 'Bash' && key === 'command';
    const max = isRichText ? RICH_TEXT_MAX : isBashCommand ? COMMAND_MAX : DEFAULT_MAX;
    if (isRichText) lineCounts[key] = countDisplayLines(value);
    if (value.length <= max) summary[key] = value;
    else if (PATH_INPUT_KEYS.has(key)) summary[key] = `...${value.slice(-(max - 3))}`;
    else summary[key] = `${value.slice(0, max)}...`;
  }
  if (Object.keys(lineCounts).length > 0) summary[TOOL_DISPLAY_METADATA_KEY] = { line_counts: lineCounts };
  return summary;
}

/** Create a compact, JSON-safe summary of a tool result payload. */
export function summarizeToolResult(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  let text: string;
  if (typeof result === 'string') {
    text = result;
  } else {
    try {
      text = JSON.stringify(result) ?? String(result);
    } catch {
      text = String(result);
    }
  }
  return text.length <= RESULT_MAX ? text : `${text.slice(0, RESULT_MAX)}...`;
}
