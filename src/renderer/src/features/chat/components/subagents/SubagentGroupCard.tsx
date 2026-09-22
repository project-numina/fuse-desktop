import { memo, useMemo } from 'react';

import RunDuration from '@/features/chat/components/RunDuration';
import { subagentStatusLabel } from '@/features/chat/components/subagents/subagent-status';
import {
  buildSubagentPreview,
  type SubagentPreviewEntry,
} from '@/features/chat/components/subagents/subagent-card-preview';
import SubagentPreviewList from '@/features/chat/components/subagents/SubagentPreviewList';
import { isLiveSubagentStatus } from '@/features/chat/state/subagents';
import type { SubagentStream } from '@/features/chat/state/types';

/**
 * Inline card shown when the orchestrator launches multiple subagents at the
 * same anchor point (a parallel spawn). Renders one outer card with a clickable
 * row per subagent; each row expands its own timeline. Prover batches also get a
 * progress header.
 */

interface SubagentGroupCardProps {
  subagents: SubagentStream[];
  childSubagents?: SubagentStream[];
  batchKind?: 'prover';
  onExpand: (parentToolUseId: string) => void;
}

interface RowData {
  subagent: SubagentStream;
  countLabel: string;
  previewEntries: SubagentPreviewEntry[];
}

type Counts = Record<SubagentStream['status'], number>;

interface CountStat {
  status: SubagentStream['status'];
  label: string;
  count: number;
}

// Memoized for the same reason as SubagentCard: the store hands down a fresh
// array identity on every streamed token.
export const SubagentGroupCard = memo(function SubagentGroupCard({
  subagents,
  childSubagents = [],
  batchKind,
  onExpand,
}: SubagentGroupCardProps) {
  // Progress cards keep their aggregate treatment; only nested launches share
  // the bounded row preview there. Ordinary groups show every preview kind.
  const isProverBatch = batchKind === 'prover'
    || subagents[0]?.synthetic === 'prover';

  const rows = useMemo<RowData[]>(
    () =>
      subagents.map((subagent) => {
        const children = childSubagents.filter(
          (child) => child.parentSubagentId === subagent.parentToolUseId,
        );
        const preview = buildSubagentPreview(subagent.toolCalls, children, {
          includeCalls: !isProverBatch,
        });
        return {
          subagent,
          countLabel:
            subagent.status === 'queued'
              ? 'Queued'
              : `${Math.max(
                preview.visibleCount,
                subagent.toolCallCount ?? 0,
              )} calls`,
          previewEntries: preview.entries,
        };
      }),
    [subagents, childSubagents, isProverBatch],
  );

  const counts = useMemo<Counts>(() => {
    const tally: Counts = {
      queued: 0,
      running: 0,
      proved: 0,
      failed: 0,
      cancelled: 0,
      done: 0,
    };
    for (const subagent of subagents) tally[subagent.status] += 1;
    return tally;
  }, [subagents]);

  const total = subagents.length;
  const finishedCount = counts.proved + counts.failed + counts.cancelled + counts.done;
  const progressPercent = total
    ? Math.round((finishedCount / total) * 100)
    : 0;
  const segmentWidth = (count: number): string => total
    ? `${(count / total) * 100}%`
    : '0%';

  const countStats = useMemo<CountStat[]>(() => {
    const ordered: { status: SubagentStream['status']; label: string }[] = [
      { status: 'running', label: 'in progress' },
      { status: 'queued', label: 'queued' },
      { status: 'proved', label: 'proved' },
      { status: 'failed', label: 'failed' },
      { status: 'cancelled', label: 'cancelled' },
    ];
    const stats = ordered.map((entry) => ({ ...entry, count: counts[entry.status] }));
    if (counts.done > 0) {
      stats.push({ status: 'done', label: 'done', count: counts.done });
    }
    return stats;
  }, [counts]);

  return (
    <div className="subagent-group">
      {isProverBatch ? (
        <div className="batch-header">
          <span className="batch-title">
            Proving {total} {total === 1 ? 'declaration' : 'declarations'}
          </span>
          {countStats.length ? (
            <div className="batch-counts">
              {countStats.map((stat) => (
                <div key={stat.status} className="count-row">
                  <span
                    className={`status-dot dot-${stat.status}`}
                    aria-hidden="true"
                  />
                  <span>
                    {stat.count} {stat.label}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div
            className="batch-progress"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="batch-progress-fill batch-progress-success"
              style={{ width: segmentWidth(counts.proved + counts.done) }}
            />
            <div
              className="batch-progress-fill batch-progress-failed"
              style={{ width: segmentWidth(counts.failed) }}
            />
            <div
              className="batch-progress-fill batch-progress-cancelled"
              style={{ width: segmentWidth(counts.cancelled) }}
            />
          </div>
        </div>
      ) : null}

      {rows.map((row) => (
        <button
          key={row.subagent.parentToolUseId}
          className={[
            'subagent-row',
            `status-${row.subagent.status}`,
            row.subagent.status === 'running' ? 'running' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          type="button"
          onClick={() => onExpand(row.subagent.parentToolUseId)}
        >
          <div className="row-top">
            <span className="row-top-left">
              <span
                className={`status-dot dot-${row.subagent.status}`}
                aria-hidden="true"
              />
              <span className="sr-only">
                Status: {subagentStatusLabel(row.subagent.status)}
              </span>
              <span className="description">{row.subagent.description}</span>
              {row.subagent.passLabel ? (
                <span className="pass-badge">{row.subagent.passLabel}</span>
              ) : null}
            </span>
            <span className="row-top-right">
              <RunDuration
                startedAt={row.subagent.startedAt}
                endedAt={row.subagent.endedAt}
                running={isLiveSubagentStatus(row.subagent.status)}
              />
              <span className="call-count">{row.countLabel}</span>
              <svg
                className="arrow-icon"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </span>
          </div>
          {row.previewEntries.length ? (
            <SubagentPreviewList
              entries={row.previewEntries}
              className="row-recent-list"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
});

export default SubagentGroupCard;
