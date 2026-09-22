import {
  createCardLayoutEngine,
  isLayoutActive,
  type CardLayoutEngine,
} from './layout';
import type {
  CardPositioningMachine,
  MachineDeps,
} from './types';
import {
  createCardVisibilityController,
  type CardVisibilityController,
} from './visibility';

/** Owns the timeout/rAF protocol that serializes full and position-only layouts. */
export function createCardPositioningMachine(deps: MachineDeps): CardPositioningMachine {
  let pendingFrame = 0;
  let pendingTimeout = 0;
  let pendingPositionFrame = 0;
  let pendingPositionTimeout = 0;
  let runningFullLayout = false;
  const burstTimeouts = new Set<number>();
  const burstFrames = new Set<number>();
  let layoutRef: CardLayoutEngine | null = null;

  function executeLayout(): boolean {
    runningFullLayout = true;
    try {
      return layoutRef?.runLayout() ?? false;
    } finally {
      runningFullLayout = false;
    }
  }

  function cancelPositionRefresh(): void {
    if (pendingPositionTimeout) {
      clearTimeout(pendingPositionTimeout);
      pendingPositionTimeout = 0;
    }
    if (pendingPositionFrame) {
      cancelAnimationFrame(pendingPositionFrame);
      pendingPositionFrame = 0;
    }
  }

  function scheduleLayout(delay = 0): void {
    if (!isLayoutActive(deps)) return;
    cancelPositionRefresh();
    if (pendingTimeout) clearTimeout(pendingTimeout);
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingTimeout = window.setTimeout(() => {
      pendingTimeout = 0;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        if (!isLayoutActive(deps)) return;
        if (executeLayout()) deps.setLayoutReady(true);
      });
    }, delay);
  }

  function cancelLayoutBurst(): void {
    burstTimeouts.forEach((timeout) => clearTimeout(timeout));
    burstTimeouts.clear();
    burstFrames.forEach((frame) => cancelAnimationFrame(frame));
    burstFrames.clear();
  }

  function runBurstFrame(frame: number): void {
    burstFrames.delete(frame);
    if (!isLayoutActive(deps)) return;
    if (executeLayout()) deps.setLayoutReady(true);
  }

  function scheduleBurstDelay(delay: number): void {
    const timeout = window.setTimeout(() => {
      burstTimeouts.delete(timeout);
      const frame = requestAnimationFrame(() => runBurstFrame(frame));
      burstFrames.add(frame);
    }, delay);
    burstTimeouts.add(timeout);
  }

  function scheduleLayoutBurst(
    delays: number[] = [0, 50, 200],
    revealOnSuccess = false,
  ): void {
    cancelLayoutBurst();
    if (!isLayoutActive(deps)) return;
    if (revealOnSuccess && deps.showAnnotationsRef.current) deps.setLayoutReady(false);
    delays.forEach(scheduleBurstDelay);
  }

  function schedulePositionRefresh(delay = 0): void {
    if (!isLayoutActive(deps) || runningFullLayout || pendingTimeout || pendingFrame) return;
    if (pendingPositionTimeout) clearTimeout(pendingPositionTimeout);
    if (pendingPositionFrame) cancelAnimationFrame(pendingPositionFrame);
    pendingPositionTimeout = window.setTimeout(() => {
      pendingPositionTimeout = 0;
      pendingPositionFrame = requestAnimationFrame(() => {
        pendingPositionFrame = 0;
        if (!isLayoutActive(deps) || runningFullLayout) return;
        layoutRef?.refreshCardPositions();
      });
    }, delay);
  }

  const visibility: CardVisibilityController = createCardVisibilityController(deps, {
    scheduleLayout,
    schedulePositionRefresh,
    updateEditorToCardOffset: (editor) => layoutRef?.updateEditorToCardOffset(editor) ?? false,
  });
  const layout = createCardLayoutEngine(deps, {
    scheduleLayout,
    observeCards: visibility.observeCards,
    seedCardHeights: visibility.seedCardHeights,
    suppressObserverUntilNextFrame: visibility.suppressObserverUntilNextFrame,
  });
  layoutRef = layout;

  function mount(): void {
    visibility.mount();
  }

  function unmount(): void {
    visibility.unmount();
    cancelLayoutBurst();
    cancelPositionRefresh();
    if (pendingTimeout) clearTimeout(pendingTimeout);
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
  }

  return { mount, unmount, scheduleLayout, scheduleLayoutBurst, schedulePositionRefresh };
}
