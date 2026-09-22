import { useCallback } from 'react';

import {
  INITIAL_TURN_SCROLL_SMOOTH_MS,
  releaseScrollOwnership,
  setScrollTop,
  startScrollOwnership,
  type TranscriptScrollMachine,
} from '@/features/chat/hooks/transcript-scroll/machine';

interface TranscriptScrollActions {
  handleScroll: () => void;
  releaseTurnScroll: () => void;
  resumeTurnScroll: () => void;
  scrollDownOnePane: () => void;
  createTurnScrollCallback: () => () => void;
}

function useOwnershipActions(
  machine: TranscriptScrollMachine,
  requestTurnSync: (behavior?: ScrollBehavior) => void,
  updateIndicator: () => void,
) {
  const releaseTurnScroll = useCallback(() => {
    releaseScrollOwnership(machine);
    updateIndicator();
  }, [machine, updateIndicator]);
  const resumeTurnScroll = useCallback(() => {
    startScrollOwnership(
      machine,
      performance.now() + INITIAL_TURN_SCROLL_SMOOTH_MS,
    );
    requestTurnSync('smooth');
  }, [machine, requestTurnSync]);
  return { releaseTurnScroll, resumeTurnScroll };
}

function useManualScrollActions(
  machine: TranscriptScrollMachine,
  updateIndicator: () => void,
) {
  const handleScroll = useCallback(() => updateIndicator(), [updateIndicator]);
  const scrollDownOnePane = useCallback(() => {
    const element = machine.scrollRef.current;
    if (!element) return;
    machine.autoFollow.current = false;
    machine.ownership.current = 'released';
    machine.smoothScrollDeadline.current = 0;
    setScrollTop(element, element.scrollHeight, 'smooth');
    updateIndicator();
  }, [machine, updateIndicator]);
  return { handleScroll, scrollDownOnePane };
}

function beginFollowing(machine: TranscriptScrollMachine): void {
  startScrollOwnership(
    machine,
    performance.now() + INITIAL_TURN_SCROLL_SMOOTH_MS,
  );
}

function usePostSendScroll(
  machine: TranscriptScrollMachine,
  requestTurnSync: (behavior?: ScrollBehavior) => void,
  updateIndicator: () => void,
) {
  return useCallback(() => {
    const turnIdBeforeSend = machine.latestTurnId.current;
    let followingStarted = false;
    return () => {
      Promise.resolve().then(() => {
        if (!machine.mounted.current) return;
        if (!followingStarted && machine.latestTurnId.current === turnIdBeforeSend) {
          updateIndicator();
          return;
        }
        const firstSync = !followingStarted;
        if (firstSync) {
          beginFollowing(machine);
          followingStarted = true;
        }
        requestTurnSync(firstSync ? 'smooth' : 'auto');
      });
    };
  }, [machine, requestTurnSync, updateIndicator]);
}

export function useTranscriptScrollActions(
  machine: TranscriptScrollMachine,
  requestTurnSync: (behavior?: ScrollBehavior) => void,
  updateIndicator: () => void,
): TranscriptScrollActions {
  const ownership = useOwnershipActions(machine, requestTurnSync, updateIndicator);
  const manual = useManualScrollActions(machine, updateIndicator);
  const createTurnScrollCallback = usePostSendScroll(
    machine,
    requestTurnSync,
    updateIndicator,
  );
  return { ...ownership, ...manual, createTurnScrollCallback };
}
