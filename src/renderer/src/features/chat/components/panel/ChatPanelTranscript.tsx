import type { RefObject } from 'react';

import ToolCallStep from '@/components/toolCalls/ToolCallStep';
import ActivityBucket from '@/features/chat/components/ActivityBucket';
import ChatMarkdown from '@/features/chat/components/ChatMarkdown';
import ContextAttachmentChip from '@/features/chat/components/ContextAttachmentChip';
import MessageCopyButton from '@/features/chat/components/MessageCopyButton';
import PendingMessages from '@/features/chat/components/PendingMessages';
import PermissionPromptCard from '@/features/chat/components/PermissionPromptCard';
import SpecialistCard from '@/features/chat/components/SpecialistCard';
import SubagentCard from '@/features/chat/components/subagents/SubagentCard';
import SubagentGroupCard from '@/features/chat/components/subagents/SubagentGroupCard';
import UserMessageText from '@/features/chat/components/UserMessageText';
import { attachmentKey } from '@/features/chat/components/composer/ChatComposer';
import type {
  BucketEntry,
  RenderedChatTurn,
} from '@/features/chat/hooks/chat-turns';
import type {
  ActivityItem,
  ChatContextAttachment,
  ChatMessage,
  PermissionPrompt,
  SubagentStream,
} from '@/features/chat/state/types';
import type { MacroDict } from '@/lib/latex-macros';

interface ChatPanelTranscriptProps {
  activityTurnId: string | null;
  activities: ActivityItem[];
  availableFilePaths: readonly string[];
  bucketEntries: (
    turnId: string,
    messageCount: number,
    frozenActivities: ActivityItem[],
  ) => BucketEntry[];
  childSubagentsOfGroup: (
    group: readonly SubagentStream[],
  ) => SubagentStream[];
  expanded: boolean;
  handleScroll: () => void;
  latestTurnId: string | null;
  macros: MacroDict;
  onExpandSubagent: (parentToolUseId: string) => void;
  onOpenContextAttachment?: (attachment: ChatContextAttachment) => void;
  onOpenFile?: (filePath: string, line?: number) => void;
  onPermissionDecision: React.ComponentProps<typeof PermissionPromptCard>['onRespond'];
  pendingUserMessages: ChatMessage[];
  permissionsPending: boolean;
  promptsForBucket: (turnId: string, messageCount: number) => PermissionPrompt[];
  promptsForTurn: (turnId: string) => PermissionPrompt[];
  releaseTurnScroll: () => void;
  renderedTurns: RenderedChatTurn[];
  responseEndRef: RefObject<HTMLDivElement | null>;
  scrollDownOnePane: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  sessionBusy: boolean;
  sessionLive: boolean;
  showMoreBelow: boolean;
  subagentsForTurn: (turnId: string) => SubagentStream[];
  transcriptRef: RefObject<HTMLDivElement | null>;
  turnHasActivity: (
    turnId: string,
    frozenActivities: ActivityItem[],
  ) => boolean;
}

interface EntryProps {
  entry: BucketEntry;
  availableFilePaths: readonly string[];
  childSubagentsOfGroup: ChatPanelTranscriptProps['childSubagentsOfGroup'];
  onExpandSubagent: (parentToolUseId: string) => void;
  onOpenFile?: (filePath: string, line?: number) => void;
}

function TranscriptEntry({
  entry,
  availableFilePaths,
  childSubagentsOfGroup,
  onExpandSubagent,
  onOpenFile,
}: EntryProps) {
  if (entry.kind === 'specialist') {
    return (
      <div className="subagent-inline-card">
        <SpecialistCard
          group={entry.group}
          childSubagents={childSubagentsOfGroup(entry.group.members)}
          onExpand={onExpandSubagent}
        />
      </div>
    );
  }
  if (entry.kind === 'subagents') {
    if (entry.subagents.length > 1) {
      return (
        <div className="subagent-inline-card">
          <SubagentGroupCard
            subagents={entry.subagents}
            childSubagents={childSubagentsOfGroup(entry.subagents)}
            onExpand={onExpandSubagent}
          />
        </div>
      );
    }
    return (
      <div className="subagent-inline-card">
        <SubagentCard
          subagent={entry.subagents[0]}
          childSubagents={childSubagentsOfGroup(entry.subagents)}
          onExpand={onExpandSubagent}
        />
      </div>
    );
  }
  return (
    <div className="chat-inline-toolcall">
      <ToolCallStep
        tool={entry.activity.tool}
        summary={entry.activity.summary}
        rawInput={entry.activity.rawInput}
        count={entry.count}
        isError={entry.activity.isError}
        errorMessage={entry.activity.result}
        availableFilePaths={availableFilePaths}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}

function PermissionCards({
  prompts,
  keyPrefix,
  onRespond,
}: {
  prompts: PermissionPrompt[];
  keyPrefix: string;
  onRespond: ChatPanelTranscriptProps['onPermissionDecision'];
}) {
  return prompts.map((prompt) => (
    <PermissionPromptCard
      key={`${keyPrefix}-permission-${prompt.request_id}`}
      prompt={prompt}
      onRespond={onRespond}
    />
  ));
}

function AgentError({ text }: { text: string }) {
  return (
    <div className="agent-message-error" role="alert">
      <svg
        className="agent-message-error-icon"
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path strokeLinecap="round" d="M8 4.75v3.5" />
        <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
      </svg>
      <span className="agent-message-error-text">{text}</span>
    </div>
  );
}

type TurnProps = Pick<ChatPanelTranscriptProps,
  | 'activityTurnId'
  | 'activities'
  | 'availableFilePaths'
  | 'bucketEntries'
  | 'childSubagentsOfGroup'
  | 'latestTurnId'
  | 'macros'
  | 'onExpandSubagent'
  | 'onOpenContextAttachment'
  | 'onOpenFile'
  | 'onPermissionDecision'
  | 'permissionsPending'
  | 'promptsForBucket'
  | 'promptsForTurn'
  | 'sessionBusy'
  | 'subagentsForTurn'
  | 'turnHasActivity'
> & { turn: RenderedChatTurn };

function UserRow({
  turn,
  onOpenContextAttachment,
}: Pick<TurnProps, 'turn' | 'onOpenContextAttachment'>) {
  if (!turn.hasUser) return null;
  return (
    <div className="chat-turn-user-row" data-message-role="user">
      <div className="flex w-full min-w-0 flex-col items-end gap-1.5">
        <UserMessageText text={turn.userText} />
        {turn.userContextAttachments.length ? (
          <div className="flex w-full min-w-0 flex-col items-end gap-1.5">
            {turn.userContextAttachments.map((attachment) => (
              <ContextAttachmentChip
                key={attachmentKey(attachment)}
                attachment={attachment}
                onOpen={onOpenContextAttachment}
              />
            ))}
          </div>
        ) : null}
        {turn.userDeliveryState === 'superseded' ? (
          <p className="pending-message-status">Not delivered to the agent</p>
        ) : null}
      </div>
    </div>
  );
}

function AgentBlock({
  block,
  blockIndex,
  turn,
  props,
}: {
  block: RenderedChatTurn['assistantRenderedBlocks'][number];
  blockIndex: number;
  turn: RenderedChatTurn;
  props: TurnProps;
}) {
  const bucketPosition = blockIndex + 1;
  const keyPrefix = `${turn.id}-${bucketPosition}`;
  return (
    <div className={`agent-text${block.isError ? ' agent-text-error' : ''}`}>
      {block.isError ? <AgentError text={block.text} /> : (
        <div className={`agent-message-body${block.state === 'streaming' ? ' agent-message-body-streaming' : ''}`}>
          <ChatMarkdown text={block.text} macros={props.macros} />
        </div>
      )}
      <ActivityBucket
        entries={props.bucketEntries(turn.id, bucketPosition, turn.frozenActivities)}
        keyPrefix={keyPrefix}
        renderEntry={(entry, key) => (
          <TranscriptEntry key={key} entry={entry} {...props} />
        )}
      />
      <PermissionCards
        prompts={props.promptsForBucket(turn.id, bucketPosition)}
        keyPrefix={keyPrefix}
        onRespond={props.onPermissionDecision}
      />
    </div>
  );
}

function AgentRow(props: TurnProps) {
  const { turn } = props;
  const showAgentRow = turn.assistantState !== 'none'
    || props.subagentsForTurn(turn.id).length > 0
    || props.turnHasActivity(turn.id, turn.frozenActivities)
    || props.promptsForTurn(turn.id).length > 0;
  if (!showAgentRow) return null;
  const showTyping = turn.assistantState === 'typing'
    && !(turn.id === props.activityTurnId
      && props.activities.some((activity) => !activity.hidden));
  const showCopy = !showTyping
    && (turn.id !== props.latestTurnId
      || (!props.sessionBusy && !props.permissionsPending))
    && turn.assistantRenderedBlocks.length > 0
    && !turn.assistantRenderedBlocks.some((block) => block.state === 'streaming');
  return (
    <div className="chat-turn-agent-row" data-message-role="agent">
      <ActivityBucket
        entries={props.bucketEntries(turn.id, 0, turn.frozenActivities)}
        keyPrefix={`${turn.id}-pre`}
        renderEntry={(entry, key) => (
          <TranscriptEntry key={key} entry={entry} {...props} />
        )}
      />
      <PermissionCards
        prompts={props.promptsForBucket(turn.id, 0)}
        keyPrefix={`${turn.id}-pre`}
        onRespond={props.onPermissionDecision}
      />
      {turn.assistantRenderedBlocks.map((block, blockIndex) => (
        <AgentBlock
          key={block.id}
          block={block}
          blockIndex={blockIndex}
          turn={turn}
          props={props}
        />
      ))}
      {showTyping ? (
        <div className="agent-text">
          <div className="chat-typing">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      ) : null}
      {showCopy ? (
        <div className="agent-message-actions">
          <MessageCopyButton
            text={turn.assistantRenderedBlocks.map((block) => block.text).join('\n\n')}
          />
        </div>
      ) : null}
    </div>
  );
}

function MoreBelowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="more-below-indicator"
      aria-label="More to read below"
      onClick={onClick}
    >
      <svg
        className="more-below-icon"
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

export default function ChatPanelTranscript(props: ChatPanelTranscriptProps) {
  return (
    <div
      ref={props.scrollRef}
      className="chat-messages"
      inert={props.expanded ? true : undefined}
      onScroll={props.handleScroll}
      onWheel={props.releaseTurnScroll}
      onMouseDown={props.releaseTurnScroll}
      onTouchStart={props.releaseTurnScroll}
    >
      <div ref={props.transcriptRef} className="chat-messages-inner">
        {props.renderedTurns.map((turn) => (
          <section key={turn.id} className="chat-turn" data-turn-id={turn.id}>
            <UserRow
              turn={turn}
              onOpenContextAttachment={props.onOpenContextAttachment}
            />
            <AgentRow {...props} turn={turn} />
          </section>
        ))}
        <div ref={props.responseEndRef} className="h-px" aria-hidden="true" />
        <PendingMessages
          messages={props.pendingUserMessages}
          sessionLive={props.sessionLive}
          onOpenContextAttachment={props.onOpenContextAttachment}
        />
      </div>
      {props.showMoreBelow ? (
        <MoreBelowButton onClick={props.scrollDownOnePane} />
      ) : null}
    </div>
  );
}
