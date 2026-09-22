import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';

import type { Collaboration } from '@/features/blueprint/hooks/use-collaboration';
import {
  cardLayoutAnnotation,
  useCardPositioning,
} from '@/features/blueprint/hooks/card-positioning';
import type { BlueprintEntry, LatexSegment } from '@/features/blueprint/hooks/latex-parser';
import { cardSpacerField, cardSpacerTheme } from '@/features/blueprint/lib/card-spacers';
import { declarationAnchorField } from '@/features/blueprint/lib/declaration-anchors';
import { useCodeMirror } from '@/hooks/use-code-mirror';
import { editorTheme, latexHighlighting, latexStructuralHighlighting } from '@/lib/editor-theme';
import { latex } from '@/lib/latex-language';

export type DeclarationSegment = LatexSegment & { entry: BlueprintEntry };

interface EditorLayoutCallbacks {
  documentChange: { current: () => void };
  viewportChange: { current: () => void };
}

function layoutUpdateExtension(callbacks: EditorLayoutCallbacks): Extension {
  return EditorView.updateListener.of((update) => {
    if (
      update.transactions.length
      && update.transactions.every(
        (transaction) => transaction.annotation(cardLayoutAnnotation),
      )
    ) return;
    if (update.docChanged) {
      callbacks.documentChange.current();
    } else if (update.viewportChanged || update.heightChanged || update.geometryChanged) {
      callbacks.viewportChange.current();
    }
  });
}

function collaborationExtensions(collaboration: Collaboration | null): Extension[] {
  if (!collaboration) return [];
  const undoManager = new Y.UndoManager(collaboration.text);
  return [
    yCollab(collaboration.text, collaboration.awareness, { undoManager }),
    keymap.of(yUndoManagerKeymap),
  ];
}

function buildExtensions(
  collaboration: Collaboration | null,
  callbacks: EditorLayoutCallbacks,
): Extension[] {
  const pageScrollTheme = EditorView.theme({ '.cm-scroller': { overflow: 'visible' } });
  return [
    lineNumbers(),
    latex(),
    EditorView.lineWrapping,
    editorTheme,
    pageScrollTheme,
    latexHighlighting,
    latexStructuralHighlighting,
    cardSpacerField,
    cardSpacerTheme,
    declarationAnchorField,
    layoutUpdateExtension(callbacks),
    ...collaborationExtensions(collaboration),
  ];
}

interface UseEditModeEditorOptions {
  collaboration: Collaboration | null;
  latexSource: string;
  onSourceChange?: (value: string) => void;
  blueprintReadonly: boolean;
  declarationSegments: DeclarationSegment[];
  showAnnotations: boolean;
  active: boolean;
}

function useDeclarationLines(segments: DeclarationSegment[]) {
  const start = useMemo(() => segments.map((segment) => segment.lineStart), [segments]);
  const end = useMemo(
    () => segments.map((segment) => segment.lineEnd ?? segment.lineStart),
    [segments],
  );
  return { start, end };
}

export function useEditModeEditor(options: UseEditModeEditorOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const documentChange = useRef<() => void>(() => {});
  const viewportChange = useRef<() => void>(() => {});
  const callbacks = useRef({ documentChange, viewportChange }).current;
  const extensions = useMemo(
    () => buildExtensions(options.collaboration, callbacks),
    // The keyed EditMode wrapper remounts whenever the collaboration doc changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const viewRef = useCodeMirror(editorContainerRef, {
    source: options.collaboration ? undefined : options.latexSource,
    onChange: options.onSourceChange,
    readonly: options.blueprintReadonly,
    extensions,
  });
  const declarationLines = useDeclarationLines(options.declarationSegments);
  const positioning = useCardPositioning({
    root: rootRef,
    viewRef,
    showAnnotations: options.showAnnotations,
    declarationSegments: options.declarationSegments,
    declarationStartLines: declarationLines.start,
    declarationEndLines: declarationLines.end,
    source: options.latexSource,
    active: options.active,
  });
  documentChange.current = positioning.scheduleLayout;
  viewportChange.current = positioning.schedulePositionRefresh;
  useActiveLayoutRefresh(options.active, viewRef, positioning.scheduleLayoutBurst);
  return { rootRef, editorContainerRef, ...positioning };
}

function useActiveLayoutRefresh(
  active: boolean,
  viewRef: ReturnType<typeof useCodeMirror>,
  scheduleLayoutBurst: (delays?: number[], revealOnSuccess?: boolean) => void,
): void {
  const refresh = useCallback(() => {
    requestAnimationFrame(() => {
      viewRef.current?.requestMeasure();
      scheduleLayoutBurst([0, 80], true);
    });
  }, [viewRef, scheduleLayoutBurst]);
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);
}
