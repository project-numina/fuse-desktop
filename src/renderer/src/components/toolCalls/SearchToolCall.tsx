/**
 * Renderer for MCP search tool calls (lean-explore, lean-lsp, etc.).
 * Shows the action name and query/name parameter if available. The query
 * extraction is shared with the tool-call coalescing key so rows only
 * collapse when they render identically.
 */

import { extractSearchQuery } from '@/lib/tool-call-grouping';

interface SearchToolCallProps {
  tool: string;
  summary: string;
  rawInput: Record<string, unknown>;
}

export function SearchToolCall({ tool, summary, rawInput }: SearchToolCallProps) {
  const query = extractSearchQuery(rawInput);

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-semibold text-foreground">{tool}</span>
      <span className="shrink-0 text-muted-foreground">{summary}</span>
      {query ? (
        <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{query}</code>
      ) : null}
    </div>
  );
}

export default SearchToolCall;
