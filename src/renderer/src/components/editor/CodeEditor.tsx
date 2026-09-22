/**
 * CodeMirror-backed code editor with LaTeX and Lean syntax support.
 *
 * `useCodeMirror` hook and assembles the language, theme, line-number, and
 * pass `value` and `onChange`.
 */

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView, lineNumbers, placeholder as placeholderExtension } from '@codemirror/view';
import { useCodeMirror } from '@/hooks/use-code-mirror';
import { lean } from '@/lib/lean-language';
import { latex } from '@/lib/latex-language';
import {
  editorTheme,
  latexHighlighting,
  latexStructuralHighlighting,
  leanHighlighting,
} from '@/lib/editor-theme';
import { cn } from '@/lib/utils';

export type EditorLanguage = 'latex' | 'lean';

interface CodeEditorProps {
  /**
   * Bound document text. Omit to run in collaboration mode (the editor's
   * document is then owned by `extensions`, e.g. a Yjs binding).
   */
  value?: string;
  /** Reports user edits. Only meaningful when `value` is provided. */
  onChange?: (value: string) => void;
  language?: EditorLanguage | null;
  readonly?: boolean;
  showLineNumbers?: boolean;
  lineWrapping?: boolean;
  placeholder?: string;
  fillHeight?: boolean;
  pageScroll?: boolean;
  latexLinting?: boolean;
  extensions?: Extension[];
  className?: string;
  /** Optional ref populated with the live `EditorView` once mounted. */
  viewRef?: RefObject<EditorView | null>;
}

export function CodeEditor({
  value,
  onChange,
  language = null,
  readonly = false,
  showLineNumbers = true,
  lineWrapping = false,
  placeholder,
  fillHeight = true,
  pageScroll = false,
  latexLinting = true,
  extensions = [],
  className,
  viewRef,
}: CodeEditorProps) {
  const container = useRef<HTMLDivElement | null>(null);

  const builtExtensions = useMemo(() => {
    const result: Extension[] = [];
    if (showLineNumbers) result.push(lineNumbers());
    if (lineWrapping) result.push(EditorView.lineWrapping);
    if (placeholder) result.push(placeholderExtension(placeholder));

    const languageExtension: Extension =
      language === 'latex'
        ? latex({ enableLinting: latexLinting })
        : language === 'lean'
          ? lean()
          : [];
    result.push(languageExtension, editorTheme);

    if (pageScroll) {
      result.push(EditorView.theme({
        '.cm-scroller': {
          overflow: 'visible',
        },
      }));
    }
    if (fillHeight) {
      result.push(EditorView.theme({
        '&': {
          height: '100%',
        },
      }));
    }
    if (language === 'latex') result.push(latexHighlighting, latexStructuralHighlighting);
    if (language === 'lean') result.push(leanHighlighting);
    result.push(...extensions);
    return result;
    // Extensions are applied once, so this is intentionally computed from the initial props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useCodeMirror(container, {
    source: value,
    onChange,
    readonly,
    extensions: builtExtensions,
  });

  // Mirror the live view into the caller-supplied ref, if any.
  useLayoutEffect(() => {
    if (!viewRef) return;
    viewRef.current = view.current;
    return () => {
      viewRef.current = null;
    };
  }, [viewRef, view]);

  return (
    <div
      ref={container}
      className={cn('min-h-0 overflow-hidden', className)}
    />
  );
}
