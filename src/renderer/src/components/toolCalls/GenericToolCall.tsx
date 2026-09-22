/**
 * Fallback renderer for unrecognized tool calls.
 * Shows the tool name and summary string.
 */

interface GenericToolCallProps {
  tool: string;
  summary: string;
}

export function GenericToolCall({ tool, summary }: GenericToolCallProps) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-semibold text-foreground">{tool}</span>
      {summary ? (
        <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
      ) : null}
    </div>
  );
}

export default GenericToolCall;
