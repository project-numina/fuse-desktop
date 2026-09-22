import { useCallback, useMemo, useState } from 'react';

import {
  SubagentExpandedSurface,
  type ExpandedRunPresentation,
  type ExpandedTimelinePresentation,
} from '@/features/chat/components/subagents/SubagentExpandedContent';
import {
  useDialogFocusTrap,
  useExpandedTimelineScroll,
  type SubagentScrollPosition,
} from '@/features/chat/components/subagents/subagent-expanded-interactions';
import {
  activityVersion,
  buildIterationOptions,
  buildTimeline,
  buildTimelineBlocks,
  exchangeStatus,
  fallbackMessageOrder,
  isActiveStatus,
  pairChildLaunchers,
  selectReadableRuns,
  selectVisibleChildren,
  selectVisibleRuns,
  visibleActivityCalls,
} from '@/features/chat/components/subagents/subagent-expanded-timeline';
import type { ActivityItem, SubagentStream } from '@/features/chat/state/types';
import { EMPTY_FILE_PATHS } from '@/lib/file-references';

export type { SubagentScrollPosition } from '@/features/chat/components/subagents/subagent-expanded-interactions';

interface SubagentExpandedViewProps {
  subagent: SubagentStream;
  /** Every run in a standing specialist exchange, oldest first. */
  members?: SubagentStream[];
  title?: string;
  childSubagents?: SubagentStream[];
  initialScroll?: SubagentScrollPosition;
  onScrollPositionChange?: (position: SubagentScrollPosition) => void;
  onExpand: (parentToolUseId: string) => void;
  onClose: () => void;
  availableFilePaths?: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

interface RunModel extends ExpandedRunPresentation {
  visibleRuns: SubagentStream[];
  visibleChildren: SubagentStream[];
  selectIteration: (runId: string) => void;
}

function useRunModel(
  subagent: SubagentStream,
  members: SubagentStream[] | undefined,
  childSubagents: SubagentStream[],
): RunModel {
  const runs = useMemo(
    () => (members?.length ? members : [subagent]),
    [members, subagent],
  );
  const readableRuns = useMemo(
    () => selectReadableRuns(runs, childSubagents),
    [childSubagents, runs],
  );
  const iterationOptions = useMemo(
    () => buildIterationOptions(readableRuns),
    [readableRuns],
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedIteration = iterationOptions.find(
    (option) => option.value === selectedRunId,
  )?.value ?? iterationOptions[iterationOptions.length - 1]?.value ?? '';
  const visibleRuns = useMemo(
    () => selectVisibleRuns(readableRuns, selectedIteration),
    [readableRuns, selectedIteration],
  );
  const visibleChildren = useMemo(
    () => selectVisibleChildren(childSubagents, readableRuns.length > 1, selectedIteration),
    [childSubagents, readableRuns.length, selectedIteration],
  );
  return {
    status: readableRuns.length > 1 ? exchangeStatus(runs, subagent.status) : subagent.status,
    active: visibleRuns.some((run) => isActiveStatus(run.status)),
    iterationOptions,
    selectedIteration,
    historyLoading: visibleRuns.some((run) => run.historyLoading),
    historyError: visibleRuns.find((run) => run.historyError)?.historyError ?? null,
    visibleRuns,
    visibleChildren,
    selectIteration: setSelectedRunId,
  };
}

function useTimelineModel(run: RunModel): ExpandedTimelinePresentation {
  const calls = useMemo<ActivityItem[]>(
    () => run.visibleRuns.flatMap((visibleRun) => visibleRun.toolCalls),
    [run.visibleRuns],
  );
  const launchers = useMemo(
    () => pairChildLaunchers(calls, run.visibleChildren),
    [calls, run.visibleChildren],
  );
  const visibleCalls = useMemo(
    () => visibleActivityCalls(calls, launchers),
    [calls, launchers],
  );
  const messageOrder = useMemo(
    () => fallbackMessageOrder(visibleCalls, run.visibleChildren),
    [run.visibleChildren, visibleCalls],
  );
  const entries = useMemo(
    () => buildTimeline(
      visibleCalls,
      run.visibleRuns,
      run.visibleChildren,
      launchers,
      messageOrder,
    ),
    [launchers, messageOrder, run.visibleChildren, run.visibleRuns, visibleCalls],
  );
  return useMemo(() => ({
    blocks: buildTimelineBlocks(entries),
    hasTimeline: entries.length > 0,
  }), [entries]);
}

function useViewActions(
  onClose: () => void,
  onOpenFile: SubagentExpandedViewProps['onOpenFile'],
  selectIteration: (runId: string) => void,
  setFollowingLatest: (following: boolean) => void,
) {
  const onIterationChange = useCallback((runId: string) => {
    selectIteration(runId);
    setFollowingLatest(false);
  }, [selectIteration, setFollowingLatest]);
  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    onClose();
    onOpenFile?.(filePath, line);
  }, [onClose, onOpenFile]);
  return { onIterationChange, handleOpenFile };
}

/**
 * Modal timeline for one subagent run or one turn of a standing specialist
 * exchange. The transcript remains mounted beneath it to retain scroll state.
 */
export function SubagentExpandedView({
  subagent,
  members,
  title,
  childSubagents = [],
  initialScroll,
  onScrollPositionChange,
  onExpand,
  onClose,
  availableFilePaths = EMPTY_FILE_PATHS,
  onOpenFile,
}: SubagentExpandedViewProps) {
  const run = useRunModel(subagent, members, childSubagents);
  const timeline = useTimelineModel(run);
  const scroll = useExpandedTimelineScroll({
    active: run.active,
    hasTimeline: timeline.hasTimeline,
    selectedIteration: run.selectedIteration,
    initialScroll,
    onScrollPositionChange,
    childActivityVersion: activityVersion(run.visibleChildren),
    runActivityVersion: activityVersion(run.visibleRuns),
  });
  const dialog = useDialogFocusTrap(onClose);
  const actions = useViewActions(
    onClose,
    onOpenFile,
    run.selectIteration,
    scroll.setFollowingLatest,
  );

  return (
    <SubagentExpandedSurface
      title={title ?? subagent.description}
      run={run}
      timeline={timeline}
      containerRef={dialog.containerRef}
      timelineRef={scroll.timelineRef}
      followingLatest={scroll.followingLatest}
      onDialogKeyDown={dialog.onKeyDown}
      onTimelineScroll={scroll.handleTimelineScroll}
      onIterationChange={actions.onIterationChange}
      onExpand={onExpand}
      onClose={onClose}
      onJumpToLatest={scroll.scrollToLatest}
      availableFilePaths={availableFilePaths}
      onOpenFile={onOpenFile ? actions.handleOpenFile : undefined}
    />
  );
}

export default SubagentExpandedView;
