/**
 * Renderer for Grep and Glob tool calls.
 * Shows the search pattern and optional scope.
 */

interface GrepToolCallProps {
  tool: string;
  rawInput: Record<string, unknown>;
}

export function GrepToolCall({ tool, rawInput }: GrepToolCallProps) {
  const pattern = String(rawInput.pattern || '');
  const path = String(rawInput.path || '');
  const shortPath = path ? path.split('/').slice(-3).join('/') : '';
  const fileType = String(rawInput.type || rawInput.glob || '');

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-semibold text-foreground">{tool}</span>
      <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{pattern}</code>
      {shortPath || fileType ? (
        <span className="shrink-0 whitespace-nowrap text-[0.6875rem] text-muted-foreground">
          {shortPath ? <>in {shortPath}</> : null}
          {fileType ? <> ({fileType})</> : null}
        </span>
      ) : null}
    </div>
  );
}

export default GrepToolCall;
