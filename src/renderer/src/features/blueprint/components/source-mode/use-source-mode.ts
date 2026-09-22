import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { RepositorySource } from '@/lib/api';
import type { ChatAttachmentSelection } from '@/features/chat/state/types';
import {
  createSourceDisplayModel,
  selectRepositorySource,
  sourceEndpoint,
  sourceTextArtifactKind,
  type SourceDisplayModel,
  type SourceModeProps,
} from './model';

const SOURCE_TEXT_PREVIEW_BYTES = 64 * 1024;

export type SourceSubView = 'latex' | 'pdf';

export interface SourceTextSelection {
  startLine: number;
  endLine: number;
  preview: string;
}

export interface SourceModeController extends SourceDisplayModel {
  subView: SourceSubView;
  setSubView: Dispatch<SetStateAction<SourceSubView>>;
  isLoadingSourceText: boolean;
  sourceTextLoadFailed: boolean;
  sourceTextPreviewTruncated: boolean;
  textSelection: SourceTextSelection | null;
  sourceSelectionExtensions: Extension[];
  attachStatus: string;
  canAttachSelection: boolean;
  attachSelectedText: () => void;
}

interface LoadedSourceText {
  content: string;
  truncated: boolean;
}

function responseIsTruncated(response: Response, text: string): boolean {
  const contentRange = response.headers?.get('Content-Range') ?? '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  const truncatedRange = total === null
    ? response.status === 206 && text.length >= SOURCE_TEXT_PREVIEW_BYTES
    : total > SOURCE_TEXT_PREVIEW_BYTES;
  return truncatedRange || text.length > SOURCE_TEXT_PREVIEW_BYTES;
}

async function fetchSourceText(url: string): Promise<LoadedSourceText> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Range: `bytes=0-${SOURCE_TEXT_PREVIEW_BYTES - 1}` },
  });
  if (!response.ok) throw new Error('Source artifact request failed');
  const text = await response.text();
  return {
    content: text.slice(0, SOURCE_TEXT_PREVIEW_BYTES),
    truncated: responseIsTruncated(response, text),
  };
}

function useSourceText(source: RepositorySource | null, artifactUrl: string): Omit<LoadedSourceText, 'content'> & {
  content: string;
  loading: boolean;
  failed: boolean;
} {
  const [state, setState] = useState({ content: '', loading: false, failed: false, truncated: false });
  const requestId = useRef(0);
  useEffect(() => {
    const currentRequest = ++requestId.current;
    setState({ content: '', loading: Boolean(source && artifactUrl), failed: false, truncated: false });
    if (!source || !artifactUrl) return;
    void fetchSourceText(artifactUrl).then(
      (loaded) => {
        if (currentRequest === requestId.current) setState({ ...loaded, loading: false, failed: false });
      },
      () => {
        if (currentRequest === requestId.current) setState({ content: '', loading: false, failed: true, truncated: false });
      },
    );
    // A source identity owns its snapshot; path inputs are stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  return state;
}

function useSourceSubView(source: RepositorySource | null, hasPdfPreview: boolean): [SourceSubView, Dispatch<SetStateAction<SourceSubView>>] {
  const [subView, setSubView] = useState<SourceSubView>('latex');
  useEffect(() => {
    setSubView(hasPdfPreview ? 'pdf' : 'latex');
    // Selection changes reset the user's current tab; preview availability has a separate fallback below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  useEffect(() => {
    if (!hasPdfPreview && subView === 'pdf') setSubView('latex');
  }, [hasPdfPreview, subView]);
  return [subView, setSubView];
}

function selectionFromUpdate(update: ViewUpdate): SourceTextSelection | null | undefined {
  if (!update.selectionSet && !update.docChanged) return undefined;
  const selection = update.state.selection.main;
  if (selection.empty) return null;
  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  return {
    startLine: update.state.doc.lineAt(from).number,
    endLine: update.state.doc.lineAt(to > from ? to - 1 : to).number,
    preview: update.state.sliceDoc(from, to).trim().replace(/\s+/g, ' ').slice(0, 120),
  };
}

function useEditorTextSelection(source: RepositorySource | null): [SourceTextSelection | null, Extension[]] {
  const [selection, setSelection] = useState<SourceTextSelection | null>(null);
  const extensions = useMemo(() => [EditorView.updateListener.of((update) => {
    const nextSelection = selectionFromUpdate(update);
    if (nextSelection !== undefined) setSelection(nextSelection);
  })], []);
  useEffect(() => setSelection(null), [source]);
  return [selection, extensions];
}

function useTransientStatus(): [string, (message: string) => void] {
  const [status, setStatus] = useState('');
  const timer = useRef<number | null>(null);
  function showStatus(message: string) {
    setStatus(message);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setStatus('');
      timer.current = null;
    }, 1800);
  }
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return [status, showStatus];
}

function selectionLabel(selection: SourceTextSelection): string {
  return selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine}-${selection.endLine}`;
}

function useSourceAttachment(source: RepositorySource | null, onAttachContext: SourceModeProps['onAttachContext']) {
  const [textSelection, sourceSelectionExtensions] = useEditorTextSelection(source);
  const [attachStatus, showAttachStatus] = useTransientStatus();
  function attachSelectedText() {
    if (!source || !onAttachContext || !textSelection) return;
    const selection: ChatAttachmentSelection = {
      kind: 'line_range',
      start_line: textSelection.startLine,
      end_line: textSelection.endLine,
    };
    onAttachContext({
      attachment_kind: 'backend_source',
      source_id: source.id,
      artifact_kind: sourceTextArtifactKind(source),
      display_name: source.display_name,
      selection,
    });
    showAttachStatus(`Attached ${selectionLabel(textSelection)}`);
  }
  return { textSelection, sourceSelectionExtensions, attachStatus, attachSelectedText };
}

export function useSourceMode({
  blueprint,
  repositorySources = [],
  selectedSourceId = '',
  owner = '',
  repo = '',
  blueprintId = '',
  publicShare = false,
  onAttachContext,
}: SourceModeProps): SourceModeController {
  const source = useMemo(
    () => selectRepositorySource(repositorySources, selectedSourceId),
    [repositorySources, selectedSourceId],
  );
  const artifactKind = sourceTextArtifactKind(source);
  const artifactUrl = source && artifactKind
    ? sourceEndpoint(source, `artifacts/${encodeURIComponent(artifactKind)}`, owner, repo, blueprintId)
    : '';
  const sourceText = useSourceText(source, artifactUrl);
  const model = createSourceDisplayModel(
    { blueprint, repositorySources, selectedSourceId, owner, repo, blueprintId, publicShare },
    sourceText.content,
  );
  const [subView, setSubView] = useSourceSubView(source, model.hasPdfPreview);
  const attachment = useSourceAttachment(source, onAttachContext);
  return {
    ...model,
    subView,
    setSubView,
    isLoadingSourceText: sourceText.loading,
    sourceTextLoadFailed: sourceText.failed,
    sourceTextPreviewTruncated: sourceText.truncated,
    canAttachSelection: Boolean(source && onAttachContext),
    ...attachment,
  };
}
