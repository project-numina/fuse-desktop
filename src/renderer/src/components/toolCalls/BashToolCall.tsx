/**
 * Renderer for Bash tool calls.
 * Shows the full command in a monospace block.
 */

interface BashToolCallProps {
  rawInput: Record<string, unknown>;
}

export function BashToolCall({ rawInput }: BashToolCallProps) {
  const command = String(rawInput.command || '');

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-semibold text-foreground">Bash</span>
      <code className="tool-command-scroll min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground [overscroll-behavior-x:contain]">
        {command}
      </code>
    </div>
  );
}

export default BashToolCall;
