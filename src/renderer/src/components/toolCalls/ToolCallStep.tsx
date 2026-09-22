/**
 * Router component for tool call rendering.
 * Picks the appropriate per-tool renderer based on tool name.
 *
 * The chat transcript renders one of these per tool-call row, passing the fields off an `ActivityItem`
 * (`tool`, `summary`, `rawInput`) plus the coalesced `count`.
 */

import { memo } from 'react';

import { EMPTY_FILE_PATHS } from '@/lib/file-references';

import EditToolCall from './EditToolCall';
import ReadToolCall from './ReadToolCall';
import WriteToolCall from './WriteToolCall';
import BashToolCall from './BashToolCall';
import GrepToolCall from './GrepToolCall';
import SearchToolCall from './SearchToolCall';
import GenericToolCall from './GenericToolCall';

export interface ToolCallStepProps {
  tool: string;
  summary: string;
  rawInput?: Record<string, unknown>;
  /**
   * How many consecutive identical calls this row represents. When > 1 a small
   * `(N)` badge is shown so repeated calls collapse into one line.
   */
  count?: number;
  isError?: boolean;
  errorMessage?: string | null;
  availableFilePaths?: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

function isFileOp(tool: string): boolean {
  return tool === 'Read';
}

function isSearchOp(tool: string): boolean {
  return tool === 'Grep' || tool === 'Glob';
}

function isMcpOp(tool: string): boolean {
  return tool === 'lean-explore' || tool === 'lean-lsp';
}

function renderToolCall(
  tool: string,
  summary: string,
  rawInput: Record<string, unknown> | undefined,
  availableFilePaths: readonly string[],
  onOpenFile: ((filePath: string, line?: number) => void) | undefined,
) {
  if (tool === 'Edit' && rawInput) {
    return (
      <EditToolCall
        rawInput={rawInput}
        availableFilePaths={availableFilePaths}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (tool === 'Write' && rawInput) {
    return (
      <WriteToolCall
        rawInput={rawInput}
        availableFilePaths={availableFilePaths}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (isFileOp(tool) && rawInput) {
    return (
      <ReadToolCall
        tool={tool}
        rawInput={rawInput}
        availableFilePaths={availableFilePaths}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (tool === 'Bash' && rawInput) {
    return <BashToolCall rawInput={rawInput} />;
  }
  if (isSearchOp(tool) && rawInput) {
    return <GrepToolCall tool={tool} rawInput={rawInput} />;
  }
  if (isMcpOp(tool) && rawInput) {
    return <SearchToolCall tool={tool} summary={summary} rawInput={rawInput} />;
  }
  return <GenericToolCall tool={tool} summary={summary} />;
}

// Memoized: the chat store reallocates its activity arrays on every streamed
// token, so an unmemoized row re-renders once per SSE delta for every call in
// a long transcript.
export const ToolCallStep = memo(function ToolCallStep({
  tool,
  summary,
  rawInput,
  count = 1,
  isError = false,
  errorMessage,
  availableFilePaths = EMPTY_FILE_PATHS,
  onOpenFile,
}: ToolCallStepProps) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 py-px text-xs leading-[1.7]">
      {/* The strikethrough plus hover title is a sighted-mouse-only signal.
          Repeat the outcome (and its reason) as text for assistive tech and
          for users who cannot perceive the decoration — WCAG 1.4.1. */}
      {isError ? (
        <span className="sr-only">
          {errorMessage ? `Failed: ${errorMessage}` : 'Failed'}
        </span>
      ) : null}
      <div
        className={`min-w-0 flex-auto${isError ? ' line-through' : ''}`}
        title={isError ? errorMessage || undefined : undefined}
      >
        {renderToolCall(
          tool,
          summary,
          rawInput,
          availableFilePaths,
          isError ? undefined : onOpenFile,
        )}
      </div>
      {count > 1 ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">({count})</span>
      ) : null}
    </div>
  );
});

export default ToolCallStep;
