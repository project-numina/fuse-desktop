import type {
  ActivityItem,
  SubagentStream,
} from '@/features/chat/state/types';
import {
  coalesceActivityCalls,
  type ActivityCallGroup,
} from '@/lib/tool-call-grouping';

const PREVIEW_ENTRY_LIMIT = 3;

export type SubagentPreviewEntry =
  | {
      kind: 'call';
      key: string;
      order: number;
      group: ActivityCallGroup;
    }
  | {
      kind: 'child';
      key: string;
      order: number;
      label: string;
    };

type PreviewCandidate =
  | { kind: 'call'; order: number; activity: ActivityItem }
  | Extract<SubagentPreviewEntry, { kind: 'child' }>;

export interface SubagentPreview {
  entries: SubagentPreviewEntry[];
  visibleCount: number;
}

export interface SubagentPreviewOptions {
  includeCalls?: boolean;
}

function previewCandidates(
  visibleCalls: ActivityItem[],
  childSubagents: SubagentStream[],
): PreviewCandidate[] {
  return [
    ...visibleCalls.map((activity) => ({
      kind: 'call' as const,
      order: activity.order ?? 0,
      activity,
    })),
    ...childSubagents.map((child) => ({
      kind: 'child' as const,
      key: `child-${child.parentToolUseId}`,
      order: child.order ?? 0,
      label: `Agent ${child.description}`,
    })),
  ].sort((left, right) => left.order - right.order);
}

function coalescePreviewCandidates(
  candidates: PreviewCandidate[],
): SubagentPreviewEntry[] {
  const entries: SubagentPreviewEntry[] = [];
  let callRun: ActivityItem[] = [];
  let callRunIndex = 0;
  const flushCallRun = () => {
    if (callRun.length === 0) return;
    for (const group of coalesceActivityCalls(callRun)) {
      entries.push({
        kind: 'call',
        key: group.activity.toolUseId || `run-${callRunIndex}-${group.key}`,
        order: group.activity.order ?? 0,
        group,
      });
    }
    callRun = [];
    callRunIndex += 1;
  };
  for (const candidate of candidates) {
    if (candidate.kind === 'call') callRun.push(candidate.activity);
    else {
      flushCallRun();
      entries.push(candidate);
    }
  }
  flushCallRun();
  return entries;
}

/**
 * Build the bounded activity preview shared by standalone and grouped cards.
 * Child launches remain rich subagent records in state, but compete with tool
 * calls for the same three chronological preview slots when calls are shown.
 */
export function buildSubagentPreview(
  toolCalls: ActivityItem[],
  childSubagents: SubagentStream[],
  options: SubagentPreviewOptions = {},
): SubagentPreview {
  const visibleCalls = toolCalls.filter((call) => !call.hidden);
  const entries = coalescePreviewCandidates(
    previewCandidates(
      options.includeCalls === false ? [] : visibleCalls,
      childSubagents,
    ),
  );

  return {
    entries: entries.slice(-PREVIEW_ENTRY_LIMIT),
    visibleCount: visibleCalls.length,
  };
}

export function subagentPreviewLabel(entry: SubagentPreviewEntry): string {
  if (entry.kind === 'child') return entry.label;
  const { activity } = entry.group;
  if (!activity.summary) return activity.tool;
  return `${activity.tool} ${activity.summary}`;
}
