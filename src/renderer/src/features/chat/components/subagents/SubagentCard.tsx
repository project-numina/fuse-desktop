import { memo, useMemo } from 'react';

import RunDuration from '@/features/chat/components/RunDuration';
import { subagentStatusLabel } from '@/features/chat/components/subagents/subagent-status';
import {
  buildSubagentPreview,
} from '@/features/chat/components/subagents/subagent-card-preview';
import SubagentPreviewList from '@/features/chat/components/subagents/SubagentPreviewList';
import { isLiveSubagentStatus } from '@/features/chat/state/subagents';
import type { SubagentStream } from '@/features/chat/state/types';

/**
 * Inline card shown in the chat stream when the orchestrator spawns a subagent.
 * Shows description, call count, and the most recent tool calls; clicking it
 * expands the full timeline.
 */

interface SubagentCardProps {
  subagent: SubagentStream;
  childSubagents?: SubagentStream[];
  onExpand: (parentToolUseId: string) => void;
}

// Memoized: the chat store reallocates its arrays on every streamed token, so
// an unmemoized row re-renders (and re-derives its preview) per SSE delta.
export const SubagentCard = memo(function SubagentCard({
  subagent,
  childSubagents = [],
  onExpand,
}: SubagentCardProps) {
  const preview = useMemo(
    () => buildSubagentPreview(subagent.toolCalls, childSubagents),
    [childSubagents, subagent.toolCalls],
  );
  const visibleCount = Math.max(
    preview.visibleCount,
    subagent.toolCallCount ?? 0,
  );

  // The explore subagent (ADR 037) is a read-only survey shown as a flat summary
  // rather than a clickable call-by-call log.
  const isExplore = subagent.synthetic === 'explore';

  const exploreSummary = useMemo<string[]>(() => {
    // A rejoined explore holds only a bounded call preview until its first
    // click hydrates the full timeline. Never present partial data as totals.
    if (subagent.historyLoaded === false) return [];
    const filesRead = new Set<string>();
    let searches = 0;
    const declarations = new Set<string>();
    let unlabeledUpdates = 0;
    for (const call of subagent.toolCalls) {
      if (call.tool === 'Read') {
        if (!call.hidden) filesRead.add(call.summary || '');
      } else if (
        call.tool === 'lean-explore'
        || call.tool === 'lean-lsp'
        || call.tool === 'Grep'
        || call.tool === 'Glob'
      ) {
        searches += 1;
      } else if (
        call.tool === 'blueprint-tools'
        && call.summary === 'update_declarations'
      ) {
        const updates = call.rawInput?.updates;
        if (Array.isArray(updates)) {
          for (const update of updates as Array<{ label?: unknown }>) {
            const label = update?.label;
            if (typeof label === 'string' && label) declarations.add(label);
            else unlabeledUpdates += 1;
          }
        } else {
          unlabeledUpdates += 1;
        }
      }
    }
    const declarationCount = declarations.size + unlabeledUpdates;
    const lines: string[] = [];
    if (filesRead.size) {
      lines.push(`Read ${filesRead.size} ${filesRead.size === 1 ? 'file' : 'files'}`);
    }
    if (searches) {
      lines.push(`Made ${searches} ${searches === 1 ? 'search' : 'searches'}`);
    }
    if (declarationCount) {
      lines.push(
        `Updated ${declarationCount} `
        + `${declarationCount === 1 ? 'declaration' : 'declarations'}`,
      );
    }
    return lines;
  }, [subagent.historyLoaded, subagent.toolCalls]);

  const className = [
    'subagent-card',
    `status-${subagent.status}`,
    subagent.status === 'running' ? 'running' : '',
    isExplore ? 'is-explore' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const topRow = (
    <div className="card-top">
      <span className="card-top-left">
        <span className={`status-dot dot-${subagent.status}`} aria-hidden="true" />
        <span className="sr-only">
          Status: {subagentStatusLabel(subagent.status)}
        </span>
        <span className="description">{subagent.description}</span>
        {subagent.passLabel ? (
          <span className="pass-badge">{subagent.passLabel}</span>
        ) : null}
      </span>
      {!isExplore ? (
        <span className="card-top-right">
          <RunDuration
            startedAt={subagent.startedAt}
            endedAt={subagent.endedAt}
            running={isLiveSubagentStatus(subagent.status)}
          />
          <span className="call-count">
            {subagent.status === 'queued' ? 'Queued' : `${visibleCount} calls`}
          </span>
          <svg
            className="arrow-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      ) : null}
    </div>
  );

  const calls =
    isExplore && exploreSummary.length ? (
      <div className="card-calls">
        {exploreSummary.map((line) => (
          <div key={line} className="card-call-row">
            <span className="card-call-label">{line}</span>
          </div>
        ))}
      </div>
    ) : !isExplore && preview.entries.length ? (
      <SubagentPreviewList entries={preview.entries} className="card-calls" />
    ) : null;

  if (isExplore) {
    if (subagent.historyLoaded === false) {
      return (
        <button
          className={className}
          type="button"
          onClick={() => onExpand(subagent.parentToolUseId)}
        >
          {topRow}
          {calls}
        </button>
      );
    }
    return (
      <div className={className}>
        {topRow}
        {calls}
      </div>
    );
  }

  return (
    <button
      className={className}
      type="button"
      onClick={() => onExpand(subagent.parentToolUseId)}
    >
      {topRow}
      {calls}
    </button>
  );
});

export default SubagentCard;
