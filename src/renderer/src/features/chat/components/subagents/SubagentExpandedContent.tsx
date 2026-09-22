import {
  Fragment,
  type KeyboardEventHandler,
  type RefObject,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Select, type SelectOption } from '@/components/ui/select';
import ToolCallStep from '@/components/toolCalls/ToolCallStep';
import ChatMarkdown from '@/features/chat/components/ChatMarkdown';
import SpecialistCard from '@/features/chat/components/SpecialistCard';
import { SubagentCard } from '@/features/chat/components/subagents/SubagentCard';
import SubagentGroupCard from '@/features/chat/components/subagents/SubagentGroupCard';
import { subagentStatusLabel } from '@/features/chat/components/subagents/subagent-status';
import type { SubagentStream } from '@/features/chat/state/types';
import type {
  TimelineBlock,
  TimelineTrailingEntry,
} from '@/features/chat/components/subagents/subagent-expanded-timeline';
import SubagentExpandedStyles from '@/features/chat/components/subagents/SubagentExpandedStyles';
import { cn } from '@/lib/utils';

const STATUS_BADGE_CLASSES: Record<SubagentStream['status'], string> = {
  queued: 'bg-transparent border-[var(--text-muted)] text-[var(--text-muted)]',
  running: 'bg-transparent border-[var(--numina-info)] text-[var(--numina-info)]',
  proved: 'bg-transparent border-[var(--status-proved-text)] text-[var(--status-proved-text)]',
  done: 'bg-transparent border-[var(--status-verified-text)] text-[var(--status-verified-text)]',
  failed: 'bg-transparent border-[var(--status-unformalized-text)] text-[var(--status-unformalized-text)]',
  cancelled: 'bg-transparent border-[var(--text-muted)] text-[var(--text-muted)]',
};

interface HeaderProps {
  title: string;
  status: SubagentStream['status'];
  iterationOptions: SelectOption[];
  selectedIteration: string;
  onIterationChange: (runId: string) => void;
  onClose: () => void;
}

export function SubagentExpandedHeader({
  title,
  status,
  iterationOptions,
  selectedIteration,
  onIterationChange,
  onClose,
}: HeaderProps) {
  return (
    <div className="subagent-expanded-header">
      <div className="subagent-expanded-header-row">
        <div className="subagent-expanded-title-row">
          <span className="subagent-expanded-title">{title}</span>
          <Badge className={cn('uppercase tracking-wide', STATUS_BADGE_CLASSES[status])}>
            {subagentStatusLabel(status)}
          </Badge>
        </div>
        <IconButton
          className="size-7"
          variant="ghost"
          radius="md"
          aria-label="Close subagent view"
          onClick={onClose}
        >
          <svg className="close-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </IconButton>
      </div>
      {iterationOptions.length > 1 ? (
        <div className="subagent-iteration-row">
          <Select
            value={selectedIteration}
            onValueChange={onIterationChange}
            options={iterationOptions}
            ariaLabel="Iteration"
            className="max-w-full"
          />
        </div>
      ) : null}
    </div>
  );
}

interface EntryProps {
  entry: TimelineTrailingEntry;
  onExpand: (parentToolUseId: string) => void;
  availableFilePaths: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

function TimelineEntryView({
  entry,
  onExpand,
  availableFilePaths,
  onOpenFile,
}: EntryProps) {
  if (entry.kind === 'specialist') {
    return (
      <div className="subagent-inline-card">
        <SpecialistCard group={entry.specialist} onExpand={onExpand} />
      </div>
    );
  }
  if (entry.kind === 'subagents') {
    const grouped = entry.subagents.length > 1 || entry.proverBatch;
    return (
      <div className="subagent-inline-card">
        {grouped ? (
          <SubagentGroupCard
            subagents={entry.subagents}
            batchKind={entry.proverBatch ? 'prover' : undefined}
            onExpand={onExpand}
          />
        ) : (
          <SubagentCard subagent={entry.subagents[0]} onExpand={onExpand} />
        )}
      </div>
    );
  }
  return (
    <div className="chat-inline-toolcall">
      <ToolCallStep
        tool={entry.group.activity.tool}
        summary={entry.group.activity.summary}
        rawInput={entry.group.activity.rawInput}
        count={entry.group.count}
        isError={entry.group.activity.isError}
        errorMessage={entry.group.activity.result}
        availableFilePaths={availableFilePaths}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}

interface BlockProps extends Omit<EntryProps, 'entry'> {
  block: TimelineBlock;
}

function TimelineBlockView({ block, ...entryProps }: BlockProps) {
  const entries = block.entries.map((entry) => (
    <TimelineEntryView key={entry.key} entry={entry} {...entryProps} />
  ));
  if (!block.message) return <div>{entries}</div>;
  return (
    <div className="agent-text">
      <div className="agent-message-body">
        <ChatMarkdown text={block.message.text} />
      </div>
      {entries}
    </div>
  );
}

interface TimelineProps extends Omit<EntryProps, 'entry'> {
  blocks: TimelineBlock[];
  timelineRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

function Timeline({
  blocks,
  timelineRef,
  onScroll,
  ...entryProps
}: TimelineProps) {
  return (
    <div
      ref={timelineRef}
      className="subagent-expanded-timeline"
      onScroll={onScroll}
    >
      {blocks.map((block, index) => (
        <Fragment key={block.message ? block.message.key : `standalone-${index}`}>
          <TimelineBlockView block={block} {...entryProps} />
        </Fragment>
      ))}
    </div>
  );
}

interface BodyProps extends Omit<TimelineProps, 'blocks'> {
  timelineBlocks: TimelineBlock[];
  historyLoading: boolean;
  historyError: string | null;
  active: boolean;
}

function EmptyState({ loading, children }: { loading?: boolean; children: string }) {
  return (
    <div className="subagent-expanded-empty">
      {loading ? <div className="waiting-spinner" /> : null}
      <span className="empty-hint">{children}</span>
    </div>
  );
}

export function SubagentExpandedBody({
  timelineBlocks,
  historyLoading,
  historyError,
  active,
  ...timelineProps
}: BodyProps) {
  if (historyLoading) return <EmptyState loading>Loading timeline...</EmptyState>;
  if (historyError) return <EmptyState>{historyError}</EmptyState>;
  if (timelineBlocks.length) {
    return <Timeline blocks={timelineBlocks} {...timelineProps} />;
  }
  return active
    ? <EmptyState loading>Waiting for tool calls...</EmptyState>
    : <EmptyState>No tool calls were recorded.</EmptyState>;
}

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="subagent-jump-latest"
      aria-label="Jump to latest"
      onClick={onClick}
    >
      <svg
        className="subagent-jump-latest-icon"
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l5 5 5-5" />
      </svg>
    </button>
  );
}

export interface ExpandedRunPresentation {
  status: SubagentStream['status'];
  active: boolean;
  iterationOptions: SelectOption[];
  selectedIteration: string;
  historyLoading: boolean;
  historyError: string | null;
}

export interface ExpandedTimelinePresentation {
  blocks: TimelineBlock[];
  hasTimeline: boolean;
}

interface SurfaceProps {
  title: string;
  run: ExpandedRunPresentation;
  timeline: ExpandedTimelinePresentation;
  containerRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  followingLatest: boolean;
  onDialogKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onTimelineScroll: () => void;
  onIterationChange: (runId: string) => void;
  onExpand: (parentToolUseId: string) => void;
  onClose: () => void;
  onJumpToLatest: () => void;
  availableFilePaths: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

export function SubagentExpandedSurface(props: SurfaceProps) {
  const { run, timeline } = props;
  const showJump = run.active && !props.followingLatest && timeline.hasTimeline;
  return (
    <div
      ref={props.containerRef}
      className="subagent-expanded"
      role="dialog"
      aria-modal="true"
      aria-label={`Subagent: ${props.title}`}
      tabIndex={-1}
      onKeyDown={props.onDialogKeyDown}
    >
      <SubagentExpandedHeader
        title={props.title}
        status={run.status}
        iterationOptions={run.iterationOptions}
        selectedIteration={run.selectedIteration}
        onIterationChange={props.onIterationChange}
        onClose={props.onClose}
      />
      <SubagentExpandedBody
        timelineBlocks={timeline.blocks}
        historyLoading={run.historyLoading}
        historyError={run.historyError}
        active={run.active}
        timelineRef={props.timelineRef}
        onScroll={props.onTimelineScroll}
        onExpand={props.onExpand}
        availableFilePaths={props.availableFilePaths}
        onOpenFile={props.onOpenFile}
      />
      {showJump ? <JumpToLatest onClick={props.onJumpToLatest} /> : null}
      <SubagentExpandedStyles />
    </div>
  );
}
