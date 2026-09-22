/**
 * Blueprint file viewer — a read-only preview of a single repository file.
 *
 * The parent supplies the file path, the already-fetched text `content` (plus loading /
 * error flags), an optional external link for the header, and an optional
 * embeddable URL for binary previews. The view picks a renderer from the file
 * extension — CodeMirror (read-only) for Lean/LaTeX source, a highlighted
 * `<pre>` for other text, and a native `<iframe>`/`<embed>` for PDFs and other
 * binaries.
 *
 * Editing is opt-in: a host that passes `readonly={false}` plus `onChange` gets
 * an editable Lean/LaTeX buffer, and `onCursorChange` reports the caret so the
 * host can drive an Infoview. Everything else (fetching, saving, diagnostics)
 * stays owned by the workspace.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ExternalLink, Paperclip, RotateCw } from 'lucide-react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import { CodeEditor, type EditorLanguage } from '@/components/editor/CodeEditor';
import {
  leanHoverExtension,
  type LeanHoverFetcher,
} from '@/features/blueprint/lib/lean-hover';
import { leanRequestErrorMessage } from '@/features/blueprint/hooks/infoview';
import { cn } from '@/lib/utils';
const PdfViewer = lazy(() => import('./PdfViewer'));

type FileKind = 'lean' | 'latex' | 'text' | 'pdf' | 'binary';

const LATEX_EXTENSIONS = new Set(['tex', 'latex', 'sty', 'cls', 'ltx']);
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'zip', 'gz', 'tar', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'olean', 'oleantmp',
]);

function fileExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(filePath: string): FileKind {
  const extension = fileExtension(filePath);
  if (extension === 'lean') return 'lean';
  if (LATEX_EXTENSIONS.has(extension)) return 'latex';
  if (extension === 'pdf') return 'pdf';
  if (BINARY_EXTENSIONS.has(extension)) return 'binary';
  return 'text';
}

export interface FileViewerProps {
  /** Repo-relative path of the file being viewed. */
  filePath: string;
  /** The file's text content. Ignored for PDF/binary kinds. */
  content?: string;
  /** Whether the parent is still fetching the file. */
  loading?: boolean;
  /** Whether the fetch failed. */
  error?: boolean;
  /** Optional external link opened from the header path. */
  githubUrl?: string;
  /**
   * Embeddable URL for PDF / binary previews. When absent, those kinds show a
   * message pointing at the header link instead of an inline preview.
   */
  fileUrl?: string;
  /**
   * Optional reload callback. When provided a "Reload" button is shown in the
   * header; the parent decides what
   * it does (e.g. re-fetch, re-elaborate imports).
   */
  onReload?: () => void | Promise<void>;
  /** Read-only by default; set false only if an editable host wires it up. */
  readonly?: boolean;
  /**
   * Reports user edits to the Lean/LaTeX buffer. Only called when the viewer is
   * editable; the host owns persisting the text.
   */
  onChange?: (value: string) => void;
  /**
   * Reports the caret as 1-based `(line, column)` on every selection or
   * document change, so a host can drive goals/diagnostics for that position.
   */
  onCursorChange?: (line: number, column: number) => void;
  /**
   * Queries the Lean LSP for hover info at a position in this file. When
   * provided, resting the pointer over an identifier in a `.lean` buffer shows
   * its signature and docstring. Omitted where no LSP is reachable (the public
   * read-only share), which leaves the editor without hovers.
   */
  leanHover?: LeanHoverFetcher;
  /** 1-based source position to reveal after the editor has loaded. */
  jumpToLine?: number;
  jumpToColumn?: number;
  onJumped?: () => void;
  className?: string;
  onAttachFile?: (selection?: { start_line: number; end_line: number }) => void;
}

export default function FileViewer({
  filePath,
  content = '',
  loading = false,
  error = false,
  githubUrl,
  fileUrl,
  onReload,
  readonly = true,
  onChange,
  onCursorChange,
  leanHover,
  jumpToLine = 0,
  jumpToColumn = 1,
  onJumped,
  className,
  onAttachFile,
}: FileViewerProps) {
  const [reloading, setReloading] = useState(false);
  const kind = fileKind(filePath);
  const canReload = !!onReload && !loading && !error;
  const editorViewRef = useRef<EditorView | null>(null);
  const [selection, setSelection] = useState<{ path: string; start_line: number; end_line: number } | null>(null);
  const pathRef = useRef(filePath);
  pathRef.current = filePath;
  const activeSelection = selection?.path === filePath ? selection : null;

  // The editor's extensions are built once, so the caret listener reads the
  // latest callback through a ref rather than capturing this render's prop.
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const cursorExtension = useMemo<Extension>(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const range = update.state.selection.main;
        setSelection(range.empty ? null : {
          path: pathRef.current,
          start_line: update.state.doc.lineAt(range.from).number,
          end_line: update.state.doc.lineAt(range.to).number,
        });
        const report = onCursorChangeRef.current;
        if (!report) return;
        const position = update.state.selection.main.head;
        const line = update.state.doc.lineAt(position);
        report(line.number, position - line.from + 1);
      }),
    [],
  );

  // Same indirection as the caret listener: the extension is built once per
  // fetcher identity, so it reads the latest callback through a ref.
  const leanHoverRef = useRef(leanHover);
  leanHoverRef.current = leanHover;
  const hoverExtension = useMemo<Extension | null>(() => {
    if (!leanHover) return null;
    return leanHoverExtension({
      fetchHover: (line, column, signal) => {
        const fetcher = leanHoverRef.current;
        if (!fetcher) return Promise.reject(new Error('Lean hover is unavailable.'));
        return fetcher(line, column, signal);
      },
      errorMessage: (value) => leanRequestErrorMessage(value, 'Could not load hover info.'),
    });
    // Rebuild only when hover availability flips; identity changes of the
    // fetcher itself are absorbed by the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!leanHover]);

  const editorExtensions = useMemo<Extension[]>(
    () => (hoverExtension ? [cursorExtension, hoverExtension] : [cursorExtension]),
    [cursorExtension, hoverExtension],
  );

  useEffect(() => {
    if (loading || error || !jumpToLine || kind === 'pdf' || kind === 'binary') return;
    const frame = requestAnimationFrame(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const line = view.state.doc.line(Math.min(jumpToLine, view.state.doc.lines));
      const anchor = line.from + Math.max(0, Math.min(line.length, jumpToColumn - 1));
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      });
      view.focus();
      onJumped?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpToLine, jumpToColumn, content, kind, loading, error, filePath, onJumped]);

  async function handleReload() {
    if (reloading || !canReload || !onReload) return;
    setReloading(true);
    try {
      await onReload();
    } finally {
      setReloading(false);
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--code-border)] bg-[var(--code-bg)]">
        <div className="flex items-center gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-2 font-mono text-xs font-semibold">
          {githubUrl ? (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-w-0 flex-1 items-center gap-1 text-[var(--code-header-text)] no-underline hover:underline"
            >
              <span
                className="overflow-hidden text-ellipsis whitespace-nowrap text-left"
                style={{ direction: 'rtl' }}
              >
                {filePath}
              </span>
              <ExternalLink
                className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </a>
          ) : (
            <span
              className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[var(--code-header-text)]"
              style={{ direction: 'rtl' }}
            >
              {filePath}
            </span>
          )}
          {onAttachFile && !loading && !error && (
            <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={activeSelection ? 'Attach selected lines to chat' : 'Attach file to chat'}
              onClick={() => onAttachFile(activeSelection ? { start_line: activeSelection.start_line, end_line: activeSelection.end_line } : undefined)}>
              <Paperclip className="h-3.5 w-3.5" />
              {activeSelection ? 'Attach selection' : 'Attach'}
            </button>
          )}
          {onReload && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 border-0 bg-transparent px-2 py-1 font-mono text-xs font-semibold text-[var(--code-header-text)] opacity-70 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!canReload || reloading}
              title="Reload file"
              onClick={handleReload}
            >
              <RotateCw
                className={cn('h-3.5 w-3.5 shrink-0', reloading && 'animate-numina-spin')}
                aria-hidden="true"
              />
              {reloading ? 'Reloading' : 'Reload'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading file...
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--numina-error)]">
            Failed to load file content.
          </div>
        ) : (
          <FileBody
            filePath={filePath}
            kind={kind}
            content={content}
            fileUrl={fileUrl}
            readonly={readonly}
            onChange={onChange}
            cursorExtension={cursorExtension}
            leanExtensions={editorExtensions}
            editorViewRef={editorViewRef}
          />
        )}
      </div>
    </div>
  );
}

interface FileBodyProps {
  filePath: string;
  kind: FileKind;
  content: string;
  fileUrl?: string;
  readonly: boolean;
  onChange?: (value: string) => void;
  cursorExtension: Extension;
  /** Cursor listener plus the Lean-only extensions (hover), for `.lean`. */
  leanExtensions: Extension[];
  editorViewRef: RefObject<EditorView | null>;
}

function FileBody({
  filePath,
  kind,
  content,
  fileUrl,
  readonly,
  onChange,
  cursorExtension,
  leanExtensions,
  editorViewRef,
}: FileBodyProps) {
  if (kind === 'pdf' || kind === 'binary') {
    if (!fileUrl) {
      return (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No inline preview is available for this file.
          {' '}
          Open it from the header link to view it.
        </div>
      );
    }
    if (kind === 'pdf') return <div className="h-[70vh]"><Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading PDF…</p>}><PdfViewer url={fileUrl} title={filePath} /></Suspense></div>;
    if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(filePath)) {
      return <img src={fileUrl} alt={filePath} className="mx-auto max-h-[70vh] max-w-full object-contain p-4" />;
    }
    return <p className="p-4 text-sm text-muted-foreground">Preview unavailable for this file type. You can still attach it to chat.</p>;
  }

  {
    const language: EditorLanguage | null = kind === 'lean' ? 'lean' : kind === 'latex' ? 'latex' : null;
    return (
      <div className="flex flex-col">
        <CodeEditor
          key={filePath}
          value={content}
          onChange={readonly ? undefined : onChange}
          language={language}
          readonly={readonly}
          showLineNumbers
          fillHeight={false}
          latexLinting={false}
          extensions={kind === 'lean' ? leanExtensions : [cursorExtension]}
          viewRef={editorViewRef}
          className="[&_.cm-editor]:bg-transparent [&_.cm-activeLine]:bg-transparent"
        />
      </div>
    );
  }

}
