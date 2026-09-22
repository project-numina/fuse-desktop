/**
 * Inline approval card for a tool call the CLI paused on.
 *
 * Rendered inside the transcript directly under the paused tool row (or above
 * the composer when the prompt names no tool row), so the user sees what the
 * agent is about to do in context. The three affordances mirror the CLI's own
 * prompt: allow this call once, accept one of the provider's suggestions
 * (typically "always allow …"), or deny.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type {
  PermissionDecisionBody,
} from '@/lib/api';
import type { PermissionPrompt } from '@/features/chat/state/types';

export interface PermissionPromptCardProps {
  prompt: PermissionPrompt;
  onRespond: (requestId: string, decision: PermissionDecisionBody) => void | Promise<void>;
}

const INPUT_PREVIEW_LIMIT = 600;

/**
 * The one line of tool input a reviewer needs: the command for Bash, the path
 * for file tools, otherwise the (truncated) JSON input.
 */
export function summarizePermissionInput(
  tool: string,
  input: Record<string, unknown>,
  limit = INPUT_PREVIEW_LIMIT,
): string {
  const pick = (key: string): string | null => (
    typeof input[key] === 'string' && (input[key] as string).trim()
      ? (input[key] as string)
      : null
  );
  let text: string | null = null;
  if (tool === 'Bash') text = pick('command');
  if (text === null) {
    text = pick('file_path') ?? pick('path') ?? pick('notebook_path')
      ?? pick('pattern') ?? pick('url') ?? pick('query');
  }
  if (text === null) {
    const keys = Object.keys(input);
    if (keys.length === 0) return '';
    try {
      text = JSON.stringify(input, null, 1).replace(/\s*\n\s*/g, ' ');
    } catch {
      text = keys.join(', ');
    }
  }
  return text.length > limit
    ? `${text.slice(0, limit)}…`
    : text;
}

export default function PermissionPromptCard({
  prompt,
  onRespond,
}: PermissionPromptCardProps) {
  // Latched on the first click so a slow round-trip cannot submit two
  // conflicting answers for the same request.
  const [decided, setDecided] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fullInput = summarizePermissionInput(prompt.tool, prompt.input, Infinity);
  const preview = expanded ? fullInput : summarizePermissionInput(prompt.tool, prompt.input);

  function respond(decision: PermissionDecisionBody): void {
    if (decided) return;
    setDecided(true);
    void onRespond(prompt.request_id, decision);
  }

  return (
    <div
      className="chat-permission-prompt my-3 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-background p-4 text-xs leading-relaxed text-foreground"
      role="group"
      aria-label={`Permission request: ${prompt.tool}`}
      aria-live="polite"
    >
      <div className="flex items-start gap-[var(--space-2)]">
        <svg
          className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--numina-accent)]"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 1.5l6 3v3.5c0 3.2-2.4 5.9-6 6.5-3.6-.6-6-3.3-6-6.5V4.5l6-3z" />
          <path strokeLinecap="round" d="M8 5.5v3" />
          <circle cx="8" cy="10.75" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="font-semibold">
            {prompt.tool === 'Bash' ? 'Run this command?' : `Allow ${prompt.tool}?`}
          </span>
          {prompt.description ? (
            <span className="text-[var(--text-body)]">{prompt.description}</span>
          ) : null}
        </div>
      </div>

      {preview ? (
        <pre className="m-0 max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-mono text-[0.6875rem] leading-relaxed text-foreground [overflow-wrap:anywhere]">
          <code>
          {preview}
          </code>
        </pre>
      ) : null}

      {fullInput.length > INPUT_PREVIEW_LIMIT && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
          className="self-start cursor-pointer text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {expanded ? 'Show less' : 'Show full input'}
        </button>
      )}

      {prompt.reason ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer text-xs focus-visible:outline-2 focus-visible:outline-ring">Why approval is needed</summary>
          <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt.reason}</p>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
          disabled={decided}
          onClick={() => respond({ behavior: 'allow' })}
        >
          Allow once
        </Button>
        {prompt.suggestions.map((suggestion, index) => (
          <Button
            key={`${prompt.request_id}-suggestion-${index}`}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-7 whitespace-normal py-1 text-left [overflow-wrap:anywhere]"
            disabled={decided}
            onClick={() => respond({ behavior: 'allow', suggestion: suggestion.payload })}
          >
            {suggestion.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={decided}
          onClick={() => respond({ behavior: 'deny' })}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}
