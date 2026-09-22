import { memo, useMemo } from 'react';

import RunDuration from '@/features/chat/components/RunDuration';
import { subagentStatusLabel } from '@/features/chat/components/subagents/subagent-status';
import { buildSubagentPreview } from '@/features/chat/components/subagents/subagent-card-preview';
import SubagentPreviewList from '@/features/chat/components/subagents/SubagentPreviewList';
import {
  specialistExpansionId,
  type SpecialistGroup,
} from '@/features/chat/state/specialists';
import { isLiveSubagentStatus } from '@/features/chat/state/subagents';
import type { SubagentStream } from '@/features/chat/state/types';

/**
 * The single node a standing specialist gets in the transcript (ADR 051).
 *
 * One node per specialist rather than one sub-card per pass: it is labelled for
 * the role it plays, fills in as the specialist keeps working, and opens onto
 * the writer/reviewer exchange behind it. Deliberately the same card chrome as
 * `SubagentCard` (status dot, title, call count, bounded recent activity),
 * because it is still one agent's work, just no longer cut up by pass.
 */

interface SpecialistCardProps {
  group: SpecialistGroup;
  childSubagents?: SubagentStream[];
  onExpand: (parentToolUseId: string) => void;
}

// Memoized for the same reason as SubagentCard: the store hands down a fresh
// array identity on every streamed token, and this card merges several runs.
export const SpecialistCard = memo(function SpecialistCard({
  group,
  childSubagents = [],
  onExpand,
}: SpecialistCardProps) {
  const preview = useMemo(
    () => buildSubagentPreview(
      group.members.flatMap((member) => member.toolCalls),
      childSubagents,
    ),
    [childSubagents, group.members],
  );
  const visibleCount = Math.max(preview.visibleCount, group.toolCallCount);

  const className = [
    'subagent-card',
    'is-specialist',
    `status-${group.status}`,
    group.status === 'running' ? 'running' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={className}
      type="button"
      onClick={() => onExpand(specialistExpansionId(group))}
    >
      <div className="card-top">
        <span className="card-top-left">
          <span className={`status-dot dot-${group.status}`} aria-hidden="true" />
          <span className="sr-only">
            Status: {subagentStatusLabel(group.status)}
          </span>
          <span className="description">{group.title}</span>
        </span>
        <span className="card-top-right">
          <RunDuration
            startedAt={group.startedAt}
            endedAt={group.endedAt}
            running={isLiveSubagentStatus(group.status)}
          />
          <span className="call-count">
            {group.status === 'queued' ? 'Queued' : `${visibleCount} calls`}
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
      </div>
      {preview.entries.length ? (
        <SubagentPreviewList entries={preview.entries} className="card-calls" />
      ) : null}
    </button>
  );
});

export default SpecialistCard;
