/**
 * Renderer for Write tool calls.
 * Shows the file path and an always-visible read-only LaTeX preview.
 *
 * The preview is a read-only
 * CodeMirror instance built directly in a layout effect so the extension set
 * stays consistent with the main editor.
 */

import { useLayoutEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { latex } from '@/lib/latex-language';
import { editorTheme, latexHighlighting, latexStructuralHighlighting } from '@/lib/editor-theme';
import { EMPTY_FILE_PATHS, resolveAvailableFilePath } from '@/lib/file-references';
import { countDisplayLines, metadataLineCount } from './displayMetadata';

interface WriteToolCallProps {
  rawInput: Record<string, unknown>;
  availableFilePaths?: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

const previewFontSize = 'var(--text-xxs)';

const compactPreviewTheme = EditorView.theme({
  '&': {
    fontSize: previewFontSize,
    backgroundColor: 'var(--diff-write-bg)',
    border: '1px solid var(--diff-write-border)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  '.cm-scroller': {
    overflow: 'auto',
    maxHeight: '360px',
  },
  '.cm-content': {
    fontSize: previewFontSize,
    lineHeight: '1.42',
    padding: '4px 0',
  },
  '.cm-line': {
    padding: '0 7px 0 5px',
  },
  '.cm-gutters': {
    background: 'var(--diff-write-gutter-bg)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--diff-write-border)',
    fontSize: previewFontSize,
    minWidth: '30px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 4px 0 2px',
    fontSize: previewFontSize,
    lineHeight: '1.42',
  },
  '.cm-content, .cm-line, .cm-gutterElement': {
    fontSize: previewFontSize,
    lineHeight: '1.42',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    background: 'transparent',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor': {
    display: 'none !important',
  },
});

export function WriteToolCall({
  rawInput,
  availableFilePaths = EMPTY_FILE_PATHS,
  onOpenFile,
}: WriteToolCallProps) {
  const filePath = String(rawInput.file_path || rawInput.path || '');
  const shortPath = filePath.split('/').pop() || filePath;
  const openablePath = resolveAvailableFilePath(filePath, availableFilePaths);
  const contentField = typeof rawInput.content === 'string' ? 'content' : 'new_string';
  const content = String(rawInput[contentField] || '');
  const hasPreview = content.length > 0;
  const isLatex = filePath.endsWith('.tex');

  const addedCount = metadataLineCount(rawInput, contentField) ?? countDisplayLines(content);

  const editorContainer = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!hasPreview) return;
    const parent = editorContainer.current;
    if (!parent) return;

    const languageExtensions: Extension[] = [];
    if (isLatex) {
      languageExtensions.push(
        latex({
          enableLinting: false,
          enableAutocomplete: false,
          autoCloseBrackets: false,
          autoCloseTags: false,
        }),
        latexHighlighting,
        latexStructuralHighlighting,
      );
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        ...languageExtensions,
        editorTheme,
        compactPreviewTheme,
      ],
    });

    const view = new EditorView({ state, parent });

    return () => {
      view.destroy();
    };
    // Preview is built once for a given rendered row and rebuilds only if its content changes.
  }, [hasPreview, isLatex, content]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex w-full min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-semibold text-foreground">Write</span>
        {openablePath && onOpenFile ? (
          <button
            type="button"
            className="min-w-0 cursor-pointer truncate text-left text-muted-foreground transition-colors hover:text-[var(--numina-accent)] hover:underline focus-visible:rounded-sm focus-visible:text-[var(--numina-accent)] focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`Open ${openablePath}`}
            title={openablePath}
            onClick={() => onOpenFile(openablePath)}
          >
            {shortPath}
          </button>
        ) : (
          <span
            className="min-w-0 truncate text-muted-foreground transition-colors"
            title={filePath || undefined}
          >
            {shortPath}
          </span>
        )}
        {hasPreview ? (
          <span className="flex shrink-0 gap-1 font-mono text-[0.6875rem]">
            <span className="text-emerald-600 dark:text-emerald-400">+{addedCount}</span>
          </span>
        ) : null}
      </div>
      {hasPreview ? <div ref={editorContainer} className="w-full min-w-0" /> : null}
    </div>
  );
}

export default WriteToolCall;
