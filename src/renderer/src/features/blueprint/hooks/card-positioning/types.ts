import { Annotation } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { RefObject } from 'react';

export interface DeclarationSegment {
  entry?: { label?: string } | null;
  declKey?: string;
}

export interface CardPositioningOptions {
  root: RefObject<HTMLElement | null>;
  viewRef: RefObject<EditorView | null>;
  showAnnotations: boolean;
  declarationSegments: DeclarationSegment[];
  declarationStartLines: number[];
  declarationEndLines: number[];
  source: string;
  active?: boolean;
  cardPaneSelector?: string;
  cardSelector?: string;
}

export interface DeclarationLayout {
  key: string;
  pos: number;
  spacerPos: number;
}

export interface MachineDeps {
  rootRef: RefObject<HTMLElement | null>;
  viewRef: RefObject<EditorView | null>;
  showAnnotationsRef: { current: boolean };
  declarationSegmentsRef: { current: DeclarationSegment[] };
  declarationStartLinesRef: { current: number[] };
  declarationEndLinesRef: { current: number[] };
  activeRef: { current: boolean | undefined };
  cardPaneSelector: string;
  cardSelector: string;
  setCardTopByDeclKey: (value: Record<string, number>) => void;
  setLayoutReady: (value: boolean) => void;
}

export interface CardPositioningMachine {
  mount: () => void;
  unmount: () => void;
  scheduleLayout: (delay?: number) => void;
  scheduleLayoutBurst: (delays?: number[], revealOnSuccess?: boolean) => void;
  schedulePositionRefresh: (delay?: number) => void;
}

export const cardLayoutAnnotation = Annotation.define<boolean>();

export const CARD_GAP = 16;
export const MEASUREMENT_TOLERANCE = 0.5;
export const MAX_MISMATCH_RETRIES = 3;
