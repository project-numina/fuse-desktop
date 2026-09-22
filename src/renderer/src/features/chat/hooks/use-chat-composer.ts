import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatComposerHandle } from '@/features/chat/components/composer/ChatComposer';
import { attachmentKey } from '@/features/chat/components/composer/ChatComposer';
import type { ChatApi } from '@/features/chat/state';
import type {
  ChatContextAttachment,
  ChatState,
} from '@/features/chat/state/types';
import {
  FOCUS_COMPOSER_EVENT,
  STOP_TURN_EVENT,
} from '@/desktop/events';

const INITIAL_SUGGESTED_MESSAGE = 'Tell me what can you do?';
const FOLLOW_UP_SUGGESTED_MESSAGE = "Tell me what's next...";
const WORKING_COMPOSER_HINT = 'Steer the agent by sending a message...';
const PERMISSION_COMPOSER_HINT =
  'Approve or deny the pending action, or steer the agent...';

interface UseChatComposerOptions {
  state: ChatState;
  send: ChatApi['send'];
  stop: ChatApi['stop'];
  readonly: boolean;
  routeKey: string;
  draftAttachments: ChatContextAttachment[];
  onDraftAttachmentsChange?: (attachments: ChatContextAttachment[]) => void;
  releaseTurnScroll: () => void;
  createTurnScrollCallback: () => () => void;
}

function mergeAttachments(
  current: ChatContextAttachment[],
  restored: ChatContextAttachment[],
): ChatContextAttachment[] {
  const merged = [...current];
  for (const attachment of restored) {
    const key = attachmentKey(attachment);
    if (!merged.some((item) => attachmentKey(item) === key)) {
      merged.push(attachment);
    }
  }
  return merged;
}

/** Owns composer drafts and restores text/attachments when a send is rejected. */
export function useChatComposer({
  state,
  send,
  stop,
  readonly,
  routeKey,
  draftAttachments,
  onDraftAttachmentsChange,
  releaseTurnScroll,
  createTurnScrollCallback,
}: UseChatComposerOptions) {
  const [input, setInput] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const draftAttachmentsRef = useRef(draftAttachments);
  const hasMessages = state.messages.length > 0;

  useEffect(() => {
    draftAttachmentsRef.current = draftAttachments;
  }, [draftAttachments]);

  const suggestedMessage = useMemo(
    () => state.suggestion?.trim()
      || (hasMessages ? FOLLOW_UP_SUGGESTED_MESSAGE : INITIAL_SUGGESTED_MESSAGE),
    [hasMessages, state.suggestion],
  );
  const composerHasContent = Boolean(input.trim() || draftAttachments.length);
  const steeringActiveWork = state.liveSession.turnActive
    || Boolean(state.liveSession.activeProverBatchId)
    || state.liveSession.activeWorkGroupCount > 0;
  const sessionBusy = state.sending || steeringActiveWork;
  const permissionsPending = state.permissions.length > 0;
  const composerPlaceholder = permissionsPending
    ? PERMISSION_COMPOSER_HINT
    : sessionBusy ? WORKING_COMPOSER_HINT : suggestedMessage;
  const canSendMessage = !readonly
    && !stopRequested
    && (
      state.liveSession.canSend
      || Boolean(
        state.sessionId
        && state.status === 'running'
        && state.liveSession.isActiveSession,
      )
    )
    && (composerHasContent || (!hasMessages && Boolean(suggestedMessage)));

  const focusInput = useCallback(() => composerRef.current?.focus(), []);
  const updateDraftAttachments = useCallback((attachments: ChatContextAttachment[]) => {
    draftAttachmentsRef.current = attachments;
    onDraftAttachmentsChange?.(attachments);
  }, [onDraftAttachmentsChange]);
  const handleComposerChange = useCallback((value: string) => {
    releaseTurnScroll();
    setInput(value);
  }, [releaseTurnScroll]);

  useEffect(() => {
    focusInput();
  }, [focusInput, routeKey, state.focusRequestToken]);
  useEffect(() => {
    if (!sessionBusy) setStopRequested(false);
  }, [sessionBusy]);

  const handleSend = useCallback(async () => {
    if (readonly) return;
    const text = input.trim() ? input : suggestedMessage;
    const sentAttachments = draftAttachments;
    releaseTurnScroll();
    setInput('');
    updateDraftAttachments([]);
    focusInput();
    const accepted = await send(
      text,
      createTurnScrollCallback,
      sentAttachments,
    ).catch(() => false);
    if (accepted) return;
    setInput((current) => (current.trim() ? `${text}\n\n${current}` : text));
    updateDraftAttachments(mergeAttachments(
      draftAttachmentsRef.current,
      sentAttachments,
    ));
    focusInput();
  }, [
    createTurnScrollCallback,
    draftAttachments,
    focusInput,
    input,
    readonly,
    releaseTurnScroll,
    send,
    suggestedMessage,
    updateDraftAttachments,
  ]);

  const addDraftAttachment = useCallback((attachment: ChatContextAttachment) => {
    const key = attachmentKey(attachment);
    if (draftAttachments.some((item) => attachmentKey(item) === key)) return;
    updateDraftAttachments([...draftAttachments, attachment]);
  }, [draftAttachments, updateDraftAttachments]);
  const removeDraftAttachment = useCallback((attachment: ChatContextAttachment) => {
    const key = attachmentKey(attachment);
    updateDraftAttachments(
      draftAttachments.filter((item) => attachmentKey(item) !== key),
    );
  }, [draftAttachments, updateDraftAttachments]);

  const handleStop = useCallback(async () => {
    if (stopRequested) return;
    setStopRequested(true);
    focusInput();
    try {
      await stop();
    } finally {
      setStopRequested(false);
    }
  }, [focusInput, stop, stopRequested]);
  const stopHandlerRef = useRef<() => void>(() => {});
  stopHandlerRef.current = () => {
    if (!sessionBusy || readonly) return;
    void handleStop();
  };

  useEffect(() => {
    const onFocusComposer = (): void => focusInput();
    const onStopTurn = (): void => stopHandlerRef.current();
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocusComposer);
    window.addEventListener(STOP_TURN_EVENT, onStopTurn);
    return () => {
      window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocusComposer);
      window.removeEventListener(STOP_TURN_EVENT, onStopTurn);
    };
  }, [focusInput]);

  return {
    addDraftAttachment,
    canSendMessage,
    composerHasContent,
    composerPlaceholder,
    composerRef,
    handleComposerChange,
    handleSend,
    handleStop,
    hasMessages,
    input,
    permissionsPending,
    removeDraftAttachment,
    sessionBusy,
    stopPending: stopRequested,
    suggestedMessage,
  };
}
