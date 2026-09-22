import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

export interface SubagentScrollPosition {
  scrollTop: number;
  following: boolean;
}

interface ScrollOptions {
  active: boolean;
  hasTimeline: boolean;
  selectedIteration: string;
  initialScroll?: SubagentScrollPosition;
  onScrollPositionChange?: (position: SubagentScrollPosition) => void;
  childActivityVersion: string;
  runActivityVersion: string;
}

interface ScrollController {
  timelineRef: RefObject<HTMLDivElement | null>;
  followingLatest: boolean;
  setFollowingLatest: (following: boolean) => void;
  scrollToLatest: () => void;
  handleTimelineScroll: () => void;
}

const FOLLOW_THRESHOLD_PX = 24;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight
    <= FOLLOW_THRESHOLD_PX;
}

function useInitialScroll(
  initialized: RefObject<boolean>,
  timelineRef: RefObject<HTMLDivElement | null>,
  options: ScrollOptions,
  scrollToLatest: () => void,
  setFollowingLatest: (following: boolean) => void,
) {
  const {
    active,
    hasTimeline,
    initialScroll,
    onScrollPositionChange,
  } = options;
  useLayoutEffect(() => {
    if (initialized.current) return;
    const element = timelineRef.current;
    if (!element) return;
    initialized.current = true;
    if (initialScroll && !(initialScroll.following && active)) {
      element.scrollTop = initialScroll.scrollTop;
      setFollowingLatest(false);
    } else if (active) scrollToLatest();
    else {
      element.scrollTop = 0;
      setFollowingLatest(false);
      onScrollPositionChange?.({ scrollTop: 0, following: false });
    }
  }, [
    active,
    hasTimeline,
    initialScroll,
    initialized,
    onScrollPositionChange,
    scrollToLatest,
    setFollowingLatest,
    timelineRef,
  ]);
}

function useIterationReset(
  selectedIteration: string,
  renderedRun: RefObject<string>,
  timelineRef: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    if (renderedRun.current === selectedIteration) return;
    renderedRun.current = selectedIteration;
    const element = timelineRef.current;
    if (element) element.scrollTop = 0;
  }, [renderedRun, selectedIteration, timelineRef]);
}

function useFollowLatest(
  initialized: RefObject<boolean>,
  followingLatest: boolean,
  scrollToLatest: () => void,
  childActivityVersion: string,
  runActivityVersion: string,
) {
  useEffect(() => {
    if (!initialized.current || !followingLatest) return;
    scrollToLatest();
  }, [
    childActivityVersion,
    followingLatest,
    initialized,
    runActivityVersion,
    scrollToLatest,
  ]);
}

export function useExpandedTimelineScroll(options: ScrollOptions): ScrollController {
  const {
    active,
    initialScroll,
    onScrollPositionChange,
    selectedIteration,
  } = options;
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const initialized = useRef(false);
  const renderedRun = useRef(selectedIteration);
  const [followingLatest, setFollowingLatest] = useState(
    active && initialScroll === undefined,
  );
  const scrollToLatest = useCallback(() => {
    const element = timelineRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setFollowingLatest(true);
    onScrollPositionChange?.({ scrollTop: element.scrollTop, following: true });
  }, [onScrollPositionChange]);
  const handleTimelineScroll = useCallback(() => {
    const element = timelineRef.current;
    if (!element) return;
    const following = active && isNearBottom(element);
    onScrollPositionChange?.({ scrollTop: element.scrollTop, following });
    if (active) setFollowingLatest(following);
  }, [active, onScrollPositionChange]);
  useInitialScroll(initialized, timelineRef, options, scrollToLatest, setFollowingLatest);
  useIterationReset(selectedIteration, renderedRun, timelineRef);
  useFollowLatest(
    initialized,
    followingLatest,
    scrollToLatest,
    options.childActivityVersion,
    options.runActivityVersion,
  );
  return {
    timelineRef, followingLatest, setFollowingLatest, scrollToLatest, handleTimelineScroll,
  };
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useDialogFocusTrap(onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    containerRef.current?.focus();
  }, []);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !containerRef.current) return;
    const focusable = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (!focusable.length) {
      event.preventDefault();
      containerRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const atStart = document.activeElement === first || document.activeElement === containerRef.current;
    if (event.shiftKey && atStart) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose]);
  return { containerRef, onKeyDown };
}
