import { useCallback } from 'react';

import {
  getActiveTurnTarget,
  setScrollTop,
  updateBottomSpacer,
  updateMoreBelow,
  type TranscriptScrollMachine,
} from '@/features/chat/hooks/transcript-scroll/machine';

interface TranscriptScrollSync {
  updateMoreBelowIndicator: () => void;
  requestTurnSync: (behavior?: ScrollBehavior) => void;
  alignLatestTurnToTop: (behavior?: ScrollBehavior, keepFollowing?: boolean) => void;
}

function finishOwnershipRelease(machine: TranscriptScrollMachine): void {
  if (!machine.releaseAfterSync.current) return;
  machine.autoFollow.current = false;
  machine.ownership.current = 'released';
  machine.smoothScrollDeadline.current = 0;
  machine.releaseAfterSync.current = false;
}

function finalizeTurnSync(
  machine: TranscriptScrollMachine,
  syncActiveTurn: (element: HTMLElement, behavior: ScrollBehavior) => void,
  updateIndicator: () => void,
): void {
  if (!machine.mounted.current) {
    machine.scrollRaf.current = null;
    return;
  }
  const element = machine.scrollRef.current;
  if (element && machine.autoFollow.current && machine.ownership.current === 'owned') {
    syncActiveTurn(element, machine.pendingBehavior.current);
  } else updateIndicator();
  finishOwnershipRelease(machine);
  machine.pendingBehavior.current = 'auto';
  machine.scrollRaf.current = null;
}

function runTurnSyncFrame(
  machine: TranscriptScrollMachine,
  finalize: () => void,
): void {
  if (!machine.mounted.current) {
    machine.scrollRaf.current = null;
    return;
  }
  if (updateBottomSpacer(machine)) {
    machine.scrollRaf.current = requestAnimationFrame(finalize);
  } else finalize();
}

function mergePendingBehavior(
  machine: TranscriptScrollMachine,
  requested: ScrollBehavior,
): void {
  machine.pendingBehavior.current = machine.pendingBehavior.current === 'smooth'
    ? 'smooth'
    : requested;
}

export function useTranscriptScrollSync(
  machine: TranscriptScrollMachine,
  setShowMoreBelow: (visible: boolean) => void,
): TranscriptScrollSync {
  const updateMoreBelowIndicator = useCallback(() => {
    updateMoreBelow(machine, setShowMoreBelow);
  }, [machine, setShowMoreBelow]);
  const syncActiveTurn = useCallback((element: HTMLElement, behavior: ScrollBehavior) => {
    setScrollTop(element, getActiveTurnTarget(machine, element), behavior);
    updateMoreBelowIndicator();
  }, [machine, updateMoreBelowIndicator]);
  const requestTurnSync = useCallback((behavior: ScrollBehavior = 'auto') => {
    Promise.resolve().then(() => {
      if (!machine.mounted.current) return;
      const keepSmooth = machine.smoothScrollDeadline.current > 0
        && performance.now() < machine.smoothScrollDeadline.current;
      mergePendingBehavior(machine, keepSmooth ? 'smooth' : behavior);
      if (machine.scrollRaf.current !== null) return;
      const finalize = () => finalizeTurnSync(
        machine,
        syncActiveTurn,
        updateMoreBelowIndicator,
      );
      machine.scrollRaf.current = requestAnimationFrame(
        () => runTurnSyncFrame(machine, finalize),
      );
    });
  }, [machine, syncActiveTurn, updateMoreBelowIndicator]);
  const alignLatestTurnToTop = useCallback((
    behavior: ScrollBehavior = 'auto',
    keepFollowing = true,
  ) => {
    if (!machine.scrollRef.current || !machine.latestTurnId.current) return;
    machine.autoFollow.current = true;
    machine.ownership.current = 'owned';
    machine.releaseAfterSync.current = !keepFollowing;
    requestTurnSync(behavior);
  }, [machine, requestTurnSync]);
  return { updateMoreBelowIndicator, requestTurnSync, alignLatestTurnToTop };
}
