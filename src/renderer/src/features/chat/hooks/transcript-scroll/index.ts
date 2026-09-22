/**
 * Coordinates transcript scrolling while the latest turn grows, yielding
 * ownership as soon as the reader navigates manually.
 */

import { useState } from 'react';

import type { RenderedChatTurn } from '@/features/chat/hooks/chat-turns';
import { useTranscriptScrollMachine } from '@/features/chat/hooks/transcript-scroll/machine';
import { useTranscriptScrollActions } from '@/features/chat/hooks/transcript-scroll/use-actions';
import {
  useTranscriptScrollMount,
  useTranscriptTurnLifecycle,
} from '@/features/chat/hooks/transcript-scroll/use-lifecycle';
import { useTranscriptScrollObservers } from '@/features/chat/hooks/transcript-scroll/use-observers';
import { useTranscriptScrollSync } from '@/features/chat/hooks/transcript-scroll/use-sync';

interface TranscriptScrollOptions {
  latestTurnId: string | null;
  renderedTurns: RenderedChatTurn[];
  isBusy: () => boolean;
}

export function useTranscriptScroll(options: TranscriptScrollOptions) {
  const { latestTurnId, renderedTurns, isBusy } = options;
  const busy = isBusy();
  const [showMoreBelow, setShowMoreBelow] = useState(false);
  const machine = useTranscriptScrollMachine(latestTurnId, isBusy);
  const {
    updateMoreBelowIndicator,
    requestTurnSync,
    alignLatestTurnToTop,
  } = useTranscriptScrollSync(machine, setShowMoreBelow);
  const {
    connectActiveTurnObserver,
    connectContainerObserver,
  } = useTranscriptScrollObservers(machine, requestTurnSync);
  const actions = useTranscriptScrollActions(
    machine,
    requestTurnSync,
    updateMoreBelowIndicator,
  );

  useTranscriptScrollMount(machine, updateMoreBelowIndicator, actions.resumeTurnScroll);
  useTranscriptTurnLifecycle(machine, {
    renderedTurns,
    latestTurnId,
    busy,
    connectActiveTurnObserver,
    connectContainerObserver,
    alignLatestTurnToTop,
    requestTurnSync,
    updateMoreBelowIndicator,
  });

  return {
    scrollRef: machine.scrollRef,
    transcriptRef: machine.transcriptRef,
    showMoreBelow,
    ...actions,
  };
}
