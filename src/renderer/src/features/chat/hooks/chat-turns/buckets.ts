import {
  isSpecialistAnchorRun,
  type SpecialistGrouping,
} from '@/features/chat/state/specialists';
import type { ActivityItem, SubagentStream } from '@/features/chat/state/types';
import { activityDisplayKey } from '@/lib/tool-call-grouping';
import type { BucketEntry } from './types';

type OrderedBucketItem =
  | { kind: 'subagent'; subagent: SubagentStream; order: number }
  | { kind: 'activity'; activity: ActivityItem; order: number };

function canGroupSubagents(previous: SubagentStream, next: SubagentStream): boolean {
  if (previous.synthetic === 'explore' || next.synthetic === 'explore') return false;
  if (previous.batchId || next.batchId) {
    return Boolean(previous.batchId) && previous.batchId === next.batchId;
  }
  return true;
}

function anchoredSubagents(
  turnId: string,
  messageCount: number,
  subagents: readonly SubagentStream[],
): OrderedBucketItem[] {
  return subagents
    .filter((subagent) => subagent.anchorTurnId === turnId
      && !subagent.parentSubagentId
      && subagent.anchorAfterMessageCount === messageCount)
    .map((subagent) => ({ kind: 'subagent', subagent, order: subagent.order ?? 0 }));
}

function anchoredActivities(
  turnId: string,
  messageCount: number,
  activities: readonly ActivityItem[],
): OrderedBucketItem[] {
  return activities
    .filter((activity) => activity.anchorTurnId === turnId
      && activity.anchorAfterMessageCount === messageCount
      && activity.tool !== 'Agent'
      && !activity.parentToolUseId
      && !activity.hidden)
    .map((activity) => ({ kind: 'activity', activity, order: activity.order ?? 0 }));
}

function appendActivity(entries: BucketEntry[], item: Extract<OrderedBucketItem, { kind: 'activity' }>): void {
  const last = entries[entries.length - 1];
  if (last?.kind === 'activity'
    && activityDisplayKey(last.activity) === activityDisplayKey(item.activity)) {
    last.count += 1;
    return;
  }
  entries.push({
    kind: 'activity',
    activity: item.activity,
    key: `tool-${item.activity.toolUseId || item.order}`,
    count: 1,
  });
}

function appendPlainSubagent(entries: BucketEntry[], subagent: SubagentStream): void {
  const last = entries[entries.length - 1];
  const canCoalesce = last?.kind === 'subagents'
    && canGroupSubagents(last.subagents[last.subagents.length - 1], subagent);
  if (canCoalesce) {
    last.subagents.push(subagent);
    return;
  }
  entries.push({
    kind: 'subagents',
    subagents: [subagent],
    key: `sub-${subagent.parentToolUseId}`,
  });
}

function appendSubagent(
  entries: BucketEntry[],
  subagent: SubagentStream,
  specialists: SpecialistGrouping,
): void {
  const group = specialists.groupByRunId.get(subagent.parentToolUseId);
  if (!group) {
    appendPlainSubagent(entries, subagent);
    return;
  }
  if (isSpecialistAnchorRun(group, subagent)) {
    entries.push({
      kind: 'specialist',
      group,
      key: `specialist-${group.members[0].parentToolUseId}`,
    });
  }
}

/** Merge anchor peers in provider order and coalesce only adjacent peers. */
export function buildBucketEntries(
  turnId: string,
  messageCount: number,
  frozenActivities: readonly ActivityItem[],
  activities: readonly ActivityItem[],
  subagents: readonly SubagentStream[],
  specialists: SpecialistGrouping,
): BucketEntry[] {
  const items = [
    ...anchoredSubagents(turnId, messageCount, subagents),
    ...anchoredActivities(turnId, messageCount, [...frozenActivities, ...activities]),
  ].sort((left, right) => left.order - right.order);
  const entries: BucketEntry[] = [];
  for (const item of items) {
    if (item.kind === 'activity') appendActivity(entries, item);
    else appendSubagent(entries, item.subagent, specialists);
  }
  return entries;
}
