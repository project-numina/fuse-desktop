import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import ChatPanelComposerArea from '@/features/chat/components/panel/ChatPanelComposerArea';
import ChatPanelTranscript from '@/features/chat/components/panel/ChatPanelTranscript';
import SubagentExpandedView from '@/features/chat/components/subagents/SubagentExpandedView';
import { useChatComposer } from '@/features/chat/hooks/use-chat-composer';
import { useChatReadReceipt } from '@/features/chat/hooks/use-chat-read-receipt';
import { useChatTurns } from '@/features/chat/hooks/chat-turns';
import { useExpandedSubagent } from '@/features/chat/hooks/use-expanded-subagent';
import { usePermissionPrompts } from '@/features/chat/hooks/use-permission-prompts';
import { useTranscriptScroll } from '@/features/chat/hooks/transcript-scroll';
import { useChat } from '@/features/chat/state';
import { createDisplayedChildSubagentsSelector } from '@/features/chat/state/subagents';
import type { ChatContextAttachment } from '@/features/chat/state/types';
import { usePanelResize } from '@/hooks/use-panel-resize';
import type { PermissionDecisionBody, RepositorySource } from '@/lib/api';
import { EMPTY_FILE_PATHS } from '@/lib/file-references';
import { EMPTY_MACROS, type MacroDict } from '@/lib/latex-macros';

export {
  FOCUS_COMPOSER_EVENT,
  STOP_TURN_EVENT,
} from '@/desktop/events';

interface ChatPanelProps {
  blueprintReadonly?: boolean;
  chatReadonlyMessage?: string;
  macros?: MacroDict;
  owner?: string;
  repository?: string;
  blueprintId?: string;
  availableSources?: RepositorySource[];
  draftAttachments?: ChatContextAttachment[];
  onDraftAttachmentsChange?: (attachments: ChatContextAttachment[]) => void;
  onSourceUploaded?: (source: RepositorySource) => void;
  onOpenContextAttachment?: (attachment: ChatContextAttachment) => void;
  availableFilePaths?: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

export default function ChatPanel({
  blueprintReadonly = false,
  chatReadonlyMessage = 'This workspace is read-only.',
  macros = EMPTY_MACROS,
  owner = '',
  repository = '',
  blueprintId = '',
  availableSources,
  draftAttachments = [],
  onDraftAttachmentsChange,
  onSourceUploaded,
  onOpenContextAttachment,
  availableFilePaths = EMPTY_FILE_PATHS,
  onOpenFile,
}: ChatPanelProps) {
  const location = useLocation();
  const {
    state,
    send,
    stop,
    respondPermission,
    loadSubagentHistory,
  } = useChat();
  const conversationReadonly = state.historySession?.can_resume === false;
  const readonly = blueprintReadonly || conversationReadonly;
  const readonlyMessage = blueprintReadonly
    ? chatReadonlyMessage
    : 'Shared chat is read-only.';
  const steeringActiveWork = state.liveSession.turnActive
    || Boolean(state.liveSession.activeProverBatchId)
    || state.liveSession.activeWorkGroupCount > 0;
  const sessionBusy = state.sending || steeringActiveWork;

  const turns = useChatTurns(state);
  const scroll = useTranscriptScroll({
    latestTurnId: turns.latestTurnId,
    renderedTurns: turns.renderedTurns,
    isBusy: () => sessionBusy,
  });
  const expanded = useExpandedSubagent({
    subagents: state.subagents,
    specialists: turns.specialists,
    viewedConversationId:
      state.viewingConversationId ?? state.conversationId,
    loadSubagentHistory,
    onOpenFile,
  });
  const composer = useChatComposer({
    state,
    send,
    stop,
    readonly,
    routeKey: `${location.pathname}${location.search}`,
    draftAttachments,
    onDraftAttachmentsChange,
    releaseTurnScroll: scroll.releaseTurnScroll,
    createTurnScrollCallback: scroll.createTurnScrollCallback,
  });
  const permissionPrompts = usePermissionPrompts(
    state.permissions,
    turns.renderedTurns,
  );
  const responseEndRef = useChatReadReceipt(
    state.viewingConversationId ?? state.conversationId,
    !sessionBusy
      && !expanded.expandedSubagentId
      && turns.renderedTurns.length > 0,
    state.sessionId ? undefined : state.historySession?.attention_revision,
  );
  const { panelWidth, startResize } = usePanelResize();
  const childSubagentsOfGroup = useMemo(
    () => createDisplayedChildSubagentsSelector(state.subagents),
    [state.subagents],
  );
  const handlePermissionDecision = useCallback(
    (requestId: string, decision: PermissionDecisionBody) =>
      respondPermission(requestId, decision),
    [respondPermission],
  );

  return (
    <div className="chat-panel" style={{ width: `${panelWidth}px` }}>
      <div className="resize-handle" onMouseDown={startResize} />

      {composer.hasMessages ? (
        <ChatPanelTranscript
          activityTurnId={turns.activityTurnId}
          activities={state.activities}
          availableFilePaths={availableFilePaths}
          bucketEntries={turns.bucketEntries}
          childSubagentsOfGroup={childSubagentsOfGroup}
          expanded={Boolean(expanded.expandedSubagent)}
          handleScroll={scroll.handleScroll}
          latestTurnId={turns.latestTurnId}
          macros={macros}
          onExpandSubagent={expanded.expandSubagent}
          onOpenContextAttachment={onOpenContextAttachment}
          onOpenFile={onOpenFile}
          onPermissionDecision={handlePermissionDecision}
          pendingUserMessages={turns.pendingUserMessages}
          permissionsPending={composer.permissionsPending}
          promptsForBucket={permissionPrompts.promptsForBucket}
          promptsForTurn={permissionPrompts.promptsForTurn}
          releaseTurnScroll={scroll.releaseTurnScroll}
          renderedTurns={turns.renderedTurns}
          responseEndRef={responseEndRef}
          scrollDownOnePane={scroll.scrollDownOnePane}
          scrollRef={scroll.scrollRef}
          sessionBusy={composer.sessionBusy}
          sessionLive={state.liveSession.isActiveSession}
          showMoreBelow={scroll.showMoreBelow}
          subagentsForTurn={turns.subagentsForTurn}
          transcriptRef={scroll.transcriptRef}
          turnHasActivity={turns.turnHasActivity}
        />
      ) : null}

      <ChatPanelComposerArea
        {...composer}
        availableSources={availableSources}
        blueprintId={blueprintId}
        draftAttachments={draftAttachments}
        expanded={Boolean(expanded.expandedSubagent)}
        onPermissionDecision={handlePermissionDecision}
        onSourceUploaded={onSourceUploaded}
        owner={owner}
        readonly={readonly}
        readonlyMessage={readonlyMessage}
        repository={repository}
        unplacedPrompts={permissionPrompts.unplacedPrompts}
      />

      {expanded.expandedSubagent ? (
        <SubagentExpandedView
          key={expanded.expandedSubagent.parentToolUseId}
          subagent={expanded.expandedSubagent}
          members={expanded.expandedSpecialist?.members}
          title={expanded.expandedSpecialist?.title}
          childSubagents={expanded.expandedChildSubagents}
          initialScroll={expanded.initialScroll}
          onScrollPositionChange={expanded.rememberScrollPosition}
          onExpand={expanded.expandSubagent}
          onClose={expanded.collapseSubagent}
          availableFilePaths={availableFilePaths}
          onOpenFile={expanded.onOpenFile}
        />
      ) : null}
    </div>
  );
}
