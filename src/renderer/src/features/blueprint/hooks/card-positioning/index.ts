/** React state and lifecycle adapter for the imperative card-positioning machine. */

import { useEffect, useRef, useState } from 'react';

import { createCardPositioningMachine } from './machine';
import type {
  CardPositioningMachine,
  CardPositioningOptions,
  DeclarationSegment,
} from './types';

export { cardLayoutAnnotation } from './types';

interface PositioningRefs {
  showAnnotationsRef: { current: boolean };
  declarationSegmentsRef: { current: DeclarationSegment[] };
  declarationStartLinesRef: { current: number[] };
  declarationEndLinesRef: { current: number[] };
  activeRef: { current: boolean | undefined };
}

function usePositioningRefs(options: CardPositioningOptions): PositioningRefs {
  const showAnnotationsRef = useRef(options.showAnnotations);
  showAnnotationsRef.current = options.showAnnotations;
  const declarationSegmentsRef = useRef(options.declarationSegments);
  declarationSegmentsRef.current = options.declarationSegments;
  const declarationStartLinesRef = useRef(options.declarationStartLines);
  declarationStartLinesRef.current = options.declarationStartLines;
  const declarationEndLinesRef = useRef(options.declarationEndLines);
  declarationEndLinesRef.current = options.declarationEndLines;
  const activeRef = useRef(options.active);
  activeRef.current = options.active;
  return {
    showAnnotationsRef,
    declarationSegmentsRef,
    declarationStartLinesRef,
    declarationEndLinesRef,
    activeRef,
  };
}

function useAfterFirstChange(value: unknown, callback: () => void): void {
  const mounted = useRef(false);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    callbackRef.current();
  }, [value]);
}

function useMachineLifecycle(machine: CardPositioningMachine): void {
  useEffect(() => {
    machine.mount();
    return () => machine.unmount();
  }, [machine]);
}

export function useCardPositioning(options: CardPositioningOptions) {
  const refs = usePositioningRefs(options);
  const [cardTopByDeclKey, setCardTopByDeclKey] = useState<Record<string, number>>({});
  const [layoutReady, setLayoutReady] = useState(() => !options.showAnnotations);
  const setCardTopsRef = useRef(setCardTopByDeclKey);
  setCardTopsRef.current = setCardTopByDeclKey;
  const setLayoutReadyRef = useRef(setLayoutReady);
  setLayoutReadyRef.current = setLayoutReady;

  const machineRef = useRef<CardPositioningMachine | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createCardPositioningMachine({
      rootRef: options.root,
      viewRef: options.viewRef,
      ...refs,
      cardPaneSelector: options.cardPaneSelector ?? '.edit-card-pane',
      cardSelector: options.cardSelector ?? '.edit-card-position',
      setCardTopByDeclKey: (value) => setCardTopsRef.current(value),
      setLayoutReady: (value) => setLayoutReadyRef.current(value),
    });
  }
  const machine = machineRef.current;
  useMachineLifecycle(machine);

  useAfterFirstChange(options.source, () => machine.scheduleLayout());
  useAfterFirstChange(options.showAnnotations, () => {
    if (!options.showAnnotations) {
      setLayoutReady(true);
      machine.scheduleLayout();
    } else machine.scheduleLayoutBurst([0, 50, 200], true);
  });
  useAfterFirstChange(options.declarationStartLines, () => machine.scheduleLayout());
  useAfterFirstChange(options.declarationEndLines, () => machine.scheduleLayout());

  return {
    cardTopByDeclKey,
    layoutReady,
    scheduleLayout: machine.scheduleLayout,
    scheduleLayoutBurst: machine.scheduleLayoutBurst,
    schedulePositionRefresh: machine.schedulePositionRefresh,
  };
}
