import { useRef } from 'react';

export const INITIAL_TURN_SCROLL_SMOOTH_MS = 300;
const TURN_SCROLL_TOP_OFFSET = 4;

interface Cell<T> {
  current: T;
}

export type ScrollOwnership = 'idle' | 'owned' | 'suspended' | 'released';

export interface TranscriptScrollMachine {
  scrollRef: Cell<HTMLDivElement | null>;
  transcriptRef: Cell<HTMLDivElement | null>;
  latestTurnId: Cell<string | null>;
  isBusy: Cell<() => boolean>;
  ownership: Cell<ScrollOwnership>;
  autoFollow: Cell<boolean>;
  scrollRaf: Cell<number | null>;
  activeTurnObserver: Cell<ResizeObserver | null>;
  containerObserver: Cell<ResizeObserver | null>;
  activeTurnObserverToken: Cell<number>;
  pendingBehavior: Cell<ScrollBehavior>;
  smoothScrollDeadline: Cell<number>;
  activeTurnSlack: Cell<number>;
  initialAlignDone: Cell<boolean>;
  releaseAfterSync: Cell<boolean>;
  mounted: Cell<boolean>;
}

function cell<T>(current: T): Cell<T> {
  return { current };
}

function createMachine(): TranscriptScrollMachine {
  return {
    scrollRef: cell<HTMLDivElement | null>(null),
    transcriptRef: cell<HTMLDivElement | null>(null),
    latestTurnId: cell<string | null>(null),
    isBusy: cell<() => boolean>(() => false),
    ownership: cell<ScrollOwnership>('idle'),
    autoFollow: cell(false),
    scrollRaf: cell<number | null>(null),
    activeTurnObserver: cell<ResizeObserver | null>(null),
    containerObserver: cell<ResizeObserver | null>(null),
    activeTurnObserverToken: cell(0),
    pendingBehavior: cell<ScrollBehavior>('auto'),
    smoothScrollDeadline: cell(0),
    activeTurnSlack: cell(0),
    initialAlignDone: cell(false),
    releaseAfterSync: cell(false),
    mounted: cell(false),
  };
}

export function useTranscriptScrollMachine(
  latestTurnId: string | null,
  isBusy: () => boolean,
): TranscriptScrollMachine {
  const machineRef = useRef<TranscriptScrollMachine | null>(null);
  if (!machineRef.current) machineRef.current = createMachine();
  machineRef.current.latestTurnId.current = latestTurnId;
  machineRef.current.isBusy.current = isBusy;
  return machineRef.current;
}

export function setScrollTop(
  element: HTMLElement,
  top: number,
  behavior: ScrollBehavior = 'auto',
): void {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const boundedTop = Math.max(0, Math.min(top, maxScrollTop));
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top: boundedTop, behavior });
  } else element.scrollTop = boundedTop;
}

function getOffsetTopWithin(container: HTMLElement, element: HTMLElement): number {
  let offset = 0;
  let current: HTMLElement | null = element;
  while (current && current !== container) {
    offset += current.offsetTop;
    current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
  }
  return offset;
}

export function getLatestTurnElement(
  machine: TranscriptScrollMachine,
  container: HTMLElement,
): HTMLElement | null {
  if (!machine.latestTurnId.current) return null;
  return container.querySelector<HTMLElement>(
    `[data-turn-id="${machine.latestTurnId.current}"]`,
  );
}

export function getActiveTurnTarget(
  machine: TranscriptScrollMachine,
  element: HTMLElement,
): number {
  const activeTurn = getLatestTurnElement(machine, element);
  if (!activeTurn) return 0;
  const anchor = activeTurn.querySelector<HTMLElement>('.user-bubble')
    ?? activeTurn.querySelector<HTMLElement>('.chat-turn-agent-row');
  if (!anchor) return 0;
  return Math.max(0, getOffsetTopWithin(element, anchor) - TURN_SCROLL_TOP_OFFSET);
}

export function setTranscriptSlack(
  machine: TranscriptScrollMachine,
  slack: number,
): boolean {
  const normalized = Math.max(0, Math.ceil(slack));
  if (normalized === machine.activeTurnSlack.current) return false;
  machine.activeTurnSlack.current = normalized;
  const transcript = machine.transcriptRef.current;
  if (transcript) transcript.style.paddingBottom = `calc(var(--space-8) + ${normalized}px)`;
  return true;
}

export function updateBottomSpacer(machine: TranscriptScrollMachine): boolean {
  const element = machine.scrollRef.current;
  const transcript = machine.transcriptRef.current;
  if (!element || !transcript) return false;
  if (!machine.latestTurnId.current) return setTranscriptSlack(machine, 0);
  const target = getActiveTurnTarget(machine, element);
  const contentHeight = Math.max(0, transcript.scrollHeight - machine.activeTurnSlack.current);
  return setTranscriptSlack(machine, target + element.clientHeight - contentHeight);
}

export function updateMoreBelow(
  machine: TranscriptScrollMachine,
  setVisible: (visible: boolean) => void,
): void {
  const element = machine.scrollRef.current;
  if (!element) {
    setVisible(false);
    return;
  }
  const remaining = Math.max(
    0,
    element.scrollHeight - element.scrollTop - element.clientHeight
      - machine.activeTurnSlack.current,
  );
  setVisible(remaining > 24);
}

export function resetScrollOwnership(machine: TranscriptScrollMachine): void {
  machine.ownership.current = 'idle';
  machine.autoFollow.current = false;
  machine.smoothScrollDeadline.current = 0;
  machine.releaseAfterSync.current = false;
  machine.initialAlignDone.current = false;
}

export function releaseScrollOwnership(machine: TranscriptScrollMachine): void {
  machine.releaseAfterSync.current = false;
  if (machine.ownership.current === 'owned' || machine.ownership.current === 'suspended') {
    machine.autoFollow.current = false;
    machine.ownership.current = 'released';
    machine.smoothScrollDeadline.current = 0;
  }
}

export function startScrollOwnership(
  machine: TranscriptScrollMachine,
  smoothDeadline = 0,
): void {
  machine.autoFollow.current = true;
  machine.ownership.current = 'owned';
  machine.smoothScrollDeadline.current = smoothDeadline;
}
