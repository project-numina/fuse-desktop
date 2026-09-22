/**
 * Renderer for Edit tool calls.
 * Shows the file path and an always-visible CodeMirror unified diff view.
 *
 * The diff is produced by a
 * read-only CodeMirror instance whose document is the new string, with
 * `unifiedMergeView({ original: oldString })` reconstructing the before/after
 * chunks in place. The editor is built directly in a layout effect (rather than
 * through `useCodeMirror`) so the extension set stays consistent with the editor
 * and nothing extra interferes with the merge-view rendering.
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { unifiedMergeView } from '@codemirror/merge';
import { latex } from '@/lib/latex-language';
import { editorTheme, latexHighlighting, latexStructuralHighlighting } from '@/lib/editor-theme';
import { EMPTY_FILE_PATHS, resolveAvailableFilePath } from '@/lib/file-references';
import { diffLineCounts } from './diffLineCounts';

interface EditToolCallProps {
  rawInput: Record<string, unknown>;
  availableFilePaths?: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

const diffFontSize = 'var(--text-xxs)';

const compactDiffTheme = EditorView.theme({
  '&': {
    fontSize: diffFontSize,
    backgroundColor: 'var(--numina-card-bg)',
    border: '1px solid var(--numina-border-light)',
    borderRadius: '8px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    maxHeight: '360px',
  },
  '.cm-content': {
    fontSize: diffFontSize,
    lineHeight: '1.42',
    padding: '4px 0',
  },
  '.cm-line': {
    padding: '0 7px 0 5px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--numina-surface-sunken)',
    borderRight: '1px solid var(--numina-border-light)',
    color: 'var(--text-muted)',
    fontSize: diffFontSize,
    minWidth: '30px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 4px 0 2px',
    fontSize: diffFontSize,
    lineHeight: '1.42',
  },
  '.cm-content, .cm-line, .cm-gutterElement': {
    fontSize: diffFontSize,
    lineHeight: '1.42',
  },
  '.cm-deletedChunk': {
    backgroundColor: 'var(--diff-deletion-bg) !important',
    fontSize: diffFontSize,
    lineHeight: '1.42',
  },
  '.cm-deletedChunk .cm-deletedText': {
    backgroundColor: 'var(--diff-deletion-highlight)',
  },
  '.cm-insertedLine': {
    backgroundColor: 'var(--diff-insertion-bg) !important',
  },
  '.cm-insertedLine .cm-insertedText': {
    backgroundColor: 'var(--diff-insertion-highlight)',
  },
  '.cm-unchangedLine': {
    color: 'var(--text-muted)',
  },
  '.cm-cursor': {
    display: 'none !important',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

export function EditToolCall({
  rawInput,
  availableFilePaths = EMPTY_FILE_PATHS,
  onOpenFile,
}: EditToolCallProps) {
  const filePath = String(rawInput.file_path || rawInput.path || '');
  const shortPath = filePath.split('/').pop() || filePath;
  const openablePath = resolveAvailableFilePath(filePath, availableFilePaths);

  const oldString = String(rawInput.old_string || '');
  const newString = String(rawInput.new_string || '');
  const hasDiff = oldString.length > 0 || newString.length > 0;
  const isLatex = filePath.endsWith('.tex');

  // Counted from the same diff the view below renders, so the badge and the
  // highlighted rows always agree. The backend's `_fuse_display.line_counts`
  // are the sizes of the two strings, which overcount every line of context
  // the model quoted to locate its edit.
  const { added: addedCount, removed: removedCount } = useMemo(
    () => diffLineCounts(oldString, newString),
    [oldString, newString],
  );

  const diffContainer = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!hasDiff) return;
    const parent = diffContainer.current;
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

    const view = new EditorView({
      doc: newString,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        ...languageExtensions,
        editorTheme,
        unifiedMergeView({
          original: oldString,
          mergeControls: false,
          gutter: true,
          allowInlineDiffs: true,
        }),
        compactDiffTheme,
      ],
      parent,
    });

    return () => {
      view.destroy();
    };
    // The diff is rebuilt only if the tool call's identity changes. The inputs
    // are derived once from the (stable) `rawInput` prop for a given rendered
    // row, keeping the rendered diff stable for that activity.
  }, [hasDiff, isLatex, oldString, newString]);

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-semibold text-foreground">Edit</span>
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
        {hasDiff ? (
          <span className="flex shrink-0 gap-1 font-mono text-[0.6875rem]">
            {addedCount ? (
              <span className="text-emerald-600 dark:text-emerald-400">+{addedCount}</span>
            ) : null}
            {removedCount ? (
              <span className="text-red-600 dark:text-red-400">-{removedCount}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {hasDiff ? <div ref={diffContainer} className="mt-1 min-w-0" /> : null}
    </div>
  );
}

export default EditToolCall;
