import { useEffect } from 'react';

import type { RenderedChatTurn } from '@/features/chat/hooks/chat-turns';
import {
  resetScrollOwnership,
  type TranscriptScrollMachine,
} from '@/features/chat/hooks/transcript-scroll/machine';
import { disconnectTranscriptObservers } from '@/features/chat/hooks/transcript-scroll/use-observers';

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (
      target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
}

function cleanupMachine(machine: TranscriptScrollMachine): void {
  machine.mounted.current = false;
  if (machine.scrollRaf.current !== null) cancelAnimationFrame(machine.scrollRaf.current);
  machine.scrollRaf.current = null;
  machine.smoothScrollDeadline.current = 0;
  disconnectTranscriptObservers(machine);
}

export function useTranscriptScrollMount(
  machine: TranscriptScrollMachine,
  updateMoreBelowIndicator: () => void,
  resumeTurnScroll: () => void,
): void {
  useEffect(() => {
    machine.mounted.current = true;
    updateMoreBelowIndicator();
    const handleWindowKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' || !machine.isBusy.current()) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      resumeTurnScroll();
    };
    window.addEventListener('keydown', handleWindowKeydown);
    return () => {
      cleanupMachine(machine);
      window.removeEventListener('keydown', handleWindowKeydown);
    };
  }, [machine, resumeTurnScroll, updateMoreBelowIndicator]);
}

interface TurnTransitionOptions {
  renderedTurns: RenderedChatTurn[];
  latestTurnId: string | null;
  busy: boolean;
  connectActiveTurnObserver: () => void;
  connectContainerObserver: () => void;
  alignLatestTurnToTop: (behavior?: ScrollBehavior, keepFollowing?: boolean) => void;
  requestTurnSync: (behavior?: ScrollBehavior) => void;
  updateMoreBelowIndicator: () => void;
}

function applyTurnTransition(
  machine: TranscriptScrollMachine,
  renderedTurns: RenderedChatTurn[],
  latestTurnId: string | null,
  busy: boolean,
  alignLatestTurnToTop: TurnTransitionOptions['alignLatestTurnToTop'],
  requestTurnSync: TurnTransitionOptions['requestTurnSync'],
): void {
  if (renderedTurns.length === 0) {
    resetScrollOwnership(machine);
  } else if (!machine.initialAlignDone.current && latestTurnId) {
    machine.initialAlignDone.current = true;
    alignLatestTurnToTop('auto', busy);
  } else if (!busy && machine.ownership.current === 'owned') {
    machine.autoFollow.current = false;
    machine.ownership.current = 'suspended';
    machine.smoothScrollDeadline.current = 0;
    machine.releaseAfterSync.current = false;
  } else if (busy && machine.ownership.current === 'suspended') {
    machine.autoFollow.current = true;
    machine.ownership.current = 'owned';
    requestTurnSync('auto');
  }
}

export function useTranscriptTurnLifecycle(
  machine: TranscriptScrollMachine,
  options: TurnTransitionOptions,
): void {
  const {
    renderedTurns,
    latestTurnId,
    busy,
    connectActiveTurnObserver,
    connectContainerObserver,
    alignLatestTurnToTop,
    requestTurnSync,
    updateMoreBelowIndicator,
  } = options;
  useEffect(() => {
    connectActiveTurnObserver();
    connectContainerObserver();
    applyTurnTransition(
      machine,
      renderedTurns,
      latestTurnId,
      busy,
      alignLatestTurnToTop,
      requestTurnSync,
    );
    updateMoreBelowIndicator();
  }, [
    alignLatestTurnToTop,
    busy,
    connectActiveTurnObserver,
    connectContainerObserver,
    latestTurnId,
    machine,
    renderedTurns,
    requestTurnSync,
    updateMoreBelowIndicator,
  ]);
}
