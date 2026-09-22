import type { SelectOption } from '@/components/ui/select';
import {
  buildSpecialistGroups,
  isReviewerRun,
  isSpecialistAnchorRun,
  specialistRole,
  type SpecialistGroup,
} from '@/features/chat/state/specialists';
import type { ActivityItem, SubagentStream } from '@/features/chat/state/types';
import {
  coalesceActivityCalls,
  type ActivityCallGroup,
} from '@/lib/tool-call-grouping';

export type TimelineEntry =
  | { kind: 'call'; key: string; order: number; group: ActivityCallGroup }
  | { kind: 'message'; key: string; order: number; text: string }
  | {
    kind: 'subagents';
    key: string;
    order: number;
    batchKey: string;
    proverBatch: boolean;
    subagents: SubagentStream[];
  }
  | {
    kind: 'specialist';
    key: string;
    order: number;
    specialist: SpecialistGroup;
  };

type UnsortedEntry =
  | { kind: 'call'; order: number; activity: ActivityItem }
  | Extract<TimelineEntry, { kind: 'message' }>
  | Extract<TimelineEntry, { kind: 'subagents' }>
  | Extract<TimelineEntry, { kind: 'specialist' }>;

export type TimelineTrailingEntry = Exclude<TimelineEntry, { kind: 'message' }>;
export interface TimelineBlock {
  message: Extract<TimelineEntry, { kind: 'message' }> | null;
  entries: TimelineTrailingEntry[];
}

export function isActiveStatus(status: SubagentStream['status']): boolean {
  return status === 'queued' || status === 'running';
}

export function selectReadableRuns(
  runs: SubagentStream[],
  childSubagents: SubagentStream[],
): SubagentStream[] {
  const withContent = runs.filter(
    (run) => isActiveStatus(run.status)
      || run.toolCalls.some((call) => !call.hidden)
      || (run.toolCallCount ?? 0) > 0
      || run.text.trim().length > 0
      || (run.messages?.some((message) => message.text.trim().length > 0) ?? false)
      || childSubagents.some((child) => child.parentSubagentId === run.parentToolUseId),
  );
  return withContent.length ? withContent : runs;
}

export function buildIterationOptions(runs: SubagentStream[]): SelectOption[] {
  if (runs.length <= 1) return [];
  const turnsBySpeaker = new Map<string, number>();
  return runs.map((run) => {
    const speaker = isReviewerRun(run) ? 'Reviewer' : specialistRole(run.description);
    const turn = (turnsBySpeaker.get(speaker) ?? 0) + 1;
    turnsBySpeaker.set(speaker, turn);
    return { value: run.parentToolUseId, label: `${speaker} ${turn}` };
  });
}

export function selectVisibleRuns(
  runs: SubagentStream[],
  selectedRunId: string,
): SubagentStream[] {
  return runs.length > 1
    ? runs.filter((run) => run.parentToolUseId === selectedRunId)
    : runs;
}

export function selectVisibleChildren(
  children: SubagentStream[],
  isExchange: boolean,
  selectedRunId: string,
): SubagentStream[] {
  return isExchange
    ? children.filter((child) => child.parentSubagentId === selectedRunId)
    : children;
}

export function exchangeStatus(
  runs: SubagentStream[],
  fallback: SubagentStream['status'],
): SubagentStream['status'] {
  if (runs.length <= 1) return fallback;
  return (runs.find((run) => isActiveStatus(run.status)) ?? runs[runs.length - 1]).status;
}

function expectedLauncherTool(child: SubagentStream): string | null {
  if (child.launcherTool) return child.launcherTool;
  if (child.synthetic === 'prover') return 'prover-tools';
  if (child.synthetic === 'authoring' || child.synthetic === 'explore') {
    return 'authoring-tools';
  }
  if (
    child.synthetic === 'regional-specialist'
    && /^Prove(?:\s|$)/i.test(child.description)
  ) return 'prover-tools';
  return null;
}

const WORKFLOW_LAUNCHER_TOOLS = new Set(['authoring-tools', 'prover-tools']);

interface LauncherIndex {
  byTool: Map<string, ActivityItem[]>;
  proverRuns: ActivityItem[];
  workflowLaunchers: ActivityItem[];
}

function buildLauncherIndex(calls: ActivityItem[]): LauncherIndex {
  const index: LauncherIndex = {
    byTool: new Map<string, ActivityItem[]>(),
    proverRuns: [],
    workflowLaunchers: [],
  };
  for (const call of calls) {
    const bucket = index.byTool.get(call.tool);
    if (bucket) bucket.push(call);
    else index.byTool.set(call.tool, [call]);
    if (call.tool === 'prover-tools' && call.summary === 'run_provers') {
      index.proverRuns.push(call);
    }
    if (WORKFLOW_LAUNCHER_TOOLS.has(call.tool)) index.workflowLaunchers.push(call);
  }
  return index;
}

function launcherCandidates(child: SubagentStream, index: LauncherIndex): ActivityItem[] {
  const expectedTool = expectedLauncherTool(child);
  if (expectedTool === 'prover-tools') return index.proverRuns;
  if (expectedTool) return index.byTool.get(expectedTool) ?? [];
  if (child.synthetic === 'regional-specialist') return index.workflowLaunchers;
  return [];
}

function pickLauncher(
  child: SubagentStream,
  candidates: ActivityItem[],
): ActivityItem | undefined {
  if (candidates.length === 0) return undefined;
  const childOrder = child.order ?? 0;
  const preceding = candidates.filter((call) => (call.order ?? 0) <= childOrder);
  if (preceding.length) {
    return preceding.reduce((latest, call) => (
      (call.order ?? 0) >= (latest.order ?? 0) ? call : latest
    ));
  }
  return candidates.reduce((nearest, call) => (
    Math.abs((call.order ?? 0) - childOrder)
      < Math.abs((nearest.order ?? 0) - childOrder) ? call : nearest
  ));
}

/** Pairs each rendered child with the one workflow call its richer card replaces. */
export function pairChildLaunchers(
  calls: ActivityItem[],
  children: SubagentStream[],
): Map<string, ActivityItem | undefined> {
  const index = buildLauncherIndex(calls);
  const pairs = new Map<string, ActivityItem | undefined>();
  const launcherByBatch = new Map<string, ActivityItem | undefined>();
  const claimedBatchLaunchers = new Set<ActivityItem>();
  for (const child of children) {
    if (child.batchId && launcherByBatch.has(child.batchId)) {
      pairs.set(child.parentToolUseId, launcherByBatch.get(child.batchId));
      continue;
    }
    const candidates = launcherCandidates(child, index);
    const available = child.batchId
      ? candidates.filter((candidate) => !claimedBatchLaunchers.has(candidate))
      : candidates;
    const launcher = pickLauncher(child, available);
    pairs.set(child.parentToolUseId, launcher);
    if (!child.batchId) continue;
    launcherByBatch.set(child.batchId, launcher);
    if (launcher) claimedBatchLaunchers.add(launcher);
  }
  return pairs;
}

export function visibleActivityCalls(
  calls: ActivityItem[],
  launcherByChild: Map<string, ActivityItem | undefined>,
): ActivityItem[] {
  const representedLaunchers = new Set<ActivityItem>();
  for (const launcher of launcherByChild.values()) {
    if (launcher) representedLaunchers.add(launcher);
  }
  return calls.filter((call) => !call.hidden && !representedLaunchers.has(call));
}

export function fallbackMessageOrder(
  calls: ActivityItem[],
  children: SubagentStream[],
): number {
  return Math.max(
    0,
    ...calls.map((activity) => activity.order ?? 0),
    ...children.map((child) => child.order ?? 0),
  ) + 1;
}

function messageEntries(
  runs: SubagentStream[],
  fallbackOrder: number,
): UnsortedEntry[] {
  const entries: UnsortedEntry[] = [];
  for (const run of runs) {
    const hasSegments = run.messages?.some((message) => message.text.trim().length > 0) ?? false;
    if (!hasSegments && run.text.trim().length === 0) continue;
    const messages = run.messages?.length
      ? run.messages
      : [{ text: run.text, order: fallbackOrder }];
    messages.forEach((message, index) => entries.push({
      kind: 'message',
      key: `message-${run.parentToolUseId}-${message.order}-${index}`,
      order: message.order,
      text: message.text,
    }));
  }
  return entries;
}

function childEntries(
  children: SubagentStream[],
  launcherByChild: Map<string, ActivityItem | undefined>,
): UnsortedEntry[] {
  const specialists = buildSpecialistGroups(children);
  const entries: UnsortedEntry[] = [];
  for (const child of children) {
    const specialist = specialists.groupByRunId.get(child.parentToolUseId);
    if (specialist) {
      if (!isSpecialistAnchorRun(specialist, child)) continue;
      entries.push({
        kind: 'specialist',
        key: `specialist-${child.parentToolUseId}`,
        order: specialist.order,
        specialist,
      });
      continue;
    }
    const launcher = launcherByChild.get(child.parentToolUseId);
    entries.push({
      kind: 'subagents',
      key: `child-${child.parentToolUseId}`,
      order: child.order ?? 0,
      batchKey: child.batchId || launcher?.toolUseId || (launcher
        ? `${launcher.tool}:${launcher.summary}:${launcher.order ?? 0}`
        : `child-${child.parentToolUseId}`),
      proverBatch: expectedLauncherTool(child) === 'prover-tools',
      subagents: [child],
    });
  }
  return entries;
}

function flushCallRun(
  calls: ActivityItem[],
  runIndex: number,
  result: TimelineEntry[],
): void {
  for (const group of coalesceActivityCalls(calls)) {
    result.push({
      kind: 'call',
      key: `run-${runIndex}-${group.key}`,
      order: group.activity.order ?? 0,
      group,
    });
  }
}

function coalesceTimeline(entries: UnsortedEntry[]): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let callRun: ActivityItem[] = [];
  let runIndex = 0;
  const flush = () => {
    if (!callRun.length) return;
    flushCallRun(callRun, runIndex, result);
    runIndex += 1;
    callRun = [];
  };
  for (const entry of entries) {
    if (entry.kind === 'call') {
      callRun.push(entry.activity);
      continue;
    }
    flush();
    const previous = result[result.length - 1];
    if (entry.kind === 'subagents' && canJoinBatch(previous, entry)) {
      previous.subagents.push(...entry.subagents);
      previous.proverBatch = previous.proverBatch && entry.proverBatch;
    } else result.push(entry);
  }
  flush();
  return result;
}

function canJoinBatch(
  previous: TimelineEntry | undefined,
  entry: Extract<UnsortedEntry, { kind: 'subagents' }>,
): previous is Extract<TimelineEntry, { kind: 'subagents' }> {
  return previous?.kind === 'subagents'
    && entry.batchKey === previous.batchKey
    && entry.subagents[0]?.synthetic !== 'explore'
    && previous.subagents[0]?.synthetic !== 'explore';
}

export function buildTimeline(
  calls: ActivityItem[],
  runs: SubagentStream[],
  children: SubagentStream[],
  launcherByChild: Map<string, ActivityItem | undefined>,
  messageOrder: number,
): TimelineEntry[] {
  const entries: UnsortedEntry[] = calls.map((activity) => ({
    kind: 'call',
    order: activity.order ?? 0,
    activity,
  }));
  entries.push(...messageEntries(runs, messageOrder));
  entries.push(...childEntries(children, launcherByChild));
  entries.sort((left, right) => left.order - right.order);
  return coalesceTimeline(entries);
}

export function buildTimelineBlocks(timeline: TimelineEntry[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const entry of timeline) {
    if (entry.kind === 'message') {
      blocks.push({ message: entry, entries: [] });
      continue;
    }
    const current = blocks[blocks.length - 1];
    if (current) current.entries.push(entry);
    else blocks.push({ message: null, entries: [entry] });
  }
  return blocks;
}

export function activityVersion(runs: SubagentStream[]): string {
  return runs.map((run) => [
    run.parentToolUseId,
    run.status,
    run.toolCalls.length,
    run.messages?.length ?? 0,
    run.text.length,
  ].join(':')).join('|');
}
