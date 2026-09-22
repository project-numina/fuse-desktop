import { useCallback } from 'react';

import {
  getLatestTurnElement,
  type TranscriptScrollMachine,
} from '@/features/chat/hooks/transcript-scroll/machine';

export function disconnectActiveTurnObserver(machine: TranscriptScrollMachine): void {
  machine.activeTurnObserverToken.current += 1;
  machine.activeTurnObserver.current?.disconnect();
  machine.activeTurnObserver.current = null;
}

export function disconnectTranscriptObservers(machine: TranscriptScrollMachine): void {
  disconnectActiveTurnObserver(machine);
  machine.containerObserver.current?.disconnect();
  machine.containerObserver.current = null;
}

export function useTranscriptScrollObservers(
  machine: TranscriptScrollMachine,
  requestTurnSync: (behavior?: ScrollBehavior) => void,
) {
  const connectActiveTurnObserver = useCallback(() => {
    disconnectActiveTurnObserver(machine);
    const observerToken = machine.activeTurnObserverToken.current;
    Promise.resolve().then(() => {
      if (observerToken !== machine.activeTurnObserverToken.current) return;
      const container = machine.scrollRef.current;
      if (!container || !machine.latestTurnId.current) return;
      const activeTurn = getLatestTurnElement(machine, container);
      if (!activeTurn) return;
      machine.activeTurnObserver.current = new ResizeObserver(() => {
        if (machine.autoFollow.current && machine.ownership.current === 'owned') {
          requestTurnSync('auto');
        }
      });
      machine.activeTurnObserver.current.observe(activeTurn);
    });
  }, [machine, requestTurnSync]);
  const connectContainerObserver = useCallback(() => {
    machine.containerObserver.current?.disconnect();
    const element = machine.scrollRef.current;
    if (!element) return;
    machine.containerObserver.current = new ResizeObserver(() => {
      requestTurnSync('auto');
    });
    machine.containerObserver.current.observe(element);
  }, [machine, requestTurnSync]);
  return { connectActiveTurnObserver, connectContainerObserver };
}
