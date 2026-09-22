import type { AgentEvent } from '@shared/agent-events';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'FileChange']);

const CLAUDE_API_ERROR_MESSAGES: Record<string, string> = {
  authentication_failed: 'Claude API authentication failed. Check your API key configuration.',
  billing_error: 'Claude API billing error. Check your Anthropic account billing status.',
  rate_limit: 'Claude API rate limit exceeded. Please try again later.',
  invalid_request: 'Invalid request sent to Claude API.',
  server_error: 'Claude API server error.',
  unknown: 'An unknown Claude API error occurred.',
};

/** Tracks only top-level calls because a nested call cannot outlive its parent. */
export class TurnLivenessTracker {
  private readonly outstanding = new Set<string>();
  private lastTopLevelLifecycleWasStart = false;

  observe(event: AgentEvent, isTopLevel: boolean): void {
    if (!isTopLevel) return;
    if (event.kind === 'tool_call_started') {
      this.outstanding.add(event.toolCallId);
      this.lastTopLevelLifecycleWasStart = true;
    } else if (event.kind === 'tool_call_completed') {
      this.outstanding.delete(event.toolCallId);
      // The first result in a parallel batch may already precede the next model call.
      this.lastTopLevelLifecycleWasStart = false;
    }
  }

  get turnIsLive(): boolean {
    return this.lastTopLevelLifecycleWasStart && this.outstanding.size > 0;
  }

  reset(): void {
    this.outstanding.clear();
    this.lastTopLevelLifecycleWasStart = false;
  }
}

export function claudeApiErrorMessage(message: string): string | undefined {
  return CLAUDE_API_ERROR_MESSAGES[message.trim()];
}

/** Whether a tool call changed a `.lean` file (used to schedule a rebuild). */
export function touchesLeanFile(tool: string, input: Record<string, unknown>): boolean {
  if (!WRITE_TOOLS.has(tool)) return false;
  const isLean = (value: unknown): boolean => typeof value === 'string' && /\.lean$/i.test(value.trim());
  if (isLean(input.file_path) || isLean(input.path) || isLean(input.notebook_path)) return true;
  const changes = input.changes;
  if (!Array.isArray(changes)) return false;
  return changes.some((change) => change && typeof change === 'object' && isLean((change as Record<string, unknown>).path));
}
