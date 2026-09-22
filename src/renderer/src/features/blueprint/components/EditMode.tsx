/** CodeMirror blueprint editing with optional Yjs and aligned declaration cards. */

import { useMemo, type CSSProperties, type RefObject } from 'react';

import MathText from '@/components/MathText';
import { Switch } from '@/components/ui/switch';
import EditModeAnnotations from '@/features/blueprint/components/EditModeAnnotations';
import { useEditModeSave } from '@/features/blueprint/components/edit-mode-save';
import {
  useEditModeEditor,
  type DeclarationSegment,
} from '@/features/blueprint/components/use-edit-mode-editor';
import type { Collaboration } from '@/features/blueprint/hooks/use-collaboration';
import type { BlueprintEntry, LatexSegment } from '@/features/blueprint/hooks/latex-parser';
import { chapterMenuLabel } from '@/features/blueprint/lib/chapter-entries';

export interface EditModeChapter {
  chapters: { path: string; label: string; title?: string; isEntrypoint: boolean }[];
  hasMultipleChapters: boolean;
  activeChapterPath: string;
  saveActiveChapter: (content: string, chapterPath?: string) => Promise<void>;
}

export interface EditSaveState {
  setPending: (pending: boolean) => void;
  setFlush?: (flush: (() => Promise<boolean>) | null) => void;
  setCleanMarker?: (marker: ((content: string) => void) | null) => void;
}

export interface EditModeBlueprint {
  id?: string;
  blueprint_file?: string;
  latex_macros?: Record<string, string>;
  entries?: unknown[];
}

export interface EditModeProps {
  blueprint: EditModeBlueprint;
  collaboration: Collaboration | null;
  latexSource: string;
  latexSegments: LatexSegment[];
  onSourceChange?: (value: string) => void;
  chapter: EditModeChapter;
  context: { owner: string; repo: string; blueprintId: string } | null;
  showCards: boolean;
  onShowCardsChange: (value: boolean) => void;
  active: boolean;
  blueprintReadonly?: boolean;
  editSaveState?: EditSaveState | null;
}

interface DerivedView {
  blueprintFileName: string;
  activeChapterLabel: string;
  declarationSegments: DeclarationSegment[];
  showAnnotations: boolean;
}

function useDerivedView(props: EditModeProps): DerivedView {
  const blueprintFileName = useMemo(() => {
    const filePath = props.chapter.activeChapterPath || props.blueprint.blueprint_file || '';
    return filePath.split('/').pop() || `${props.blueprint.id}.tex`;
  }, [props.chapter.activeChapterPath, props.blueprint]);
  const activeChapterLabel = useMemo(() => {
    const activeEntry = props.chapter.chapters.find(
      (entry) => entry.path === props.chapter.activeChapterPath,
    );
    return activeEntry ? chapterMenuLabel(activeEntry) : blueprintFileName;
  }, [props.chapter.chapters, props.chapter.activeChapterPath, blueprintFileName]);
  const declarationSegments = useMemo(
    () => props.latexSegments.filter(
      (segment): segment is LatexSegment & { entry: BlueprintEntry } =>
        segment.type === 'decl' && Boolean(segment.entry),
    ),
    [props.latexSegments],
  );
  return {
    blueprintFileName,
    activeChapterLabel,
    declarationSegments,
    showAnnotations: props.showCards && declarationSegments.length > 0,
  };
}

function AnnotationToggle({ checked, onChange }: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-[var(--space-1)]">
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onChange}
        aria-label="Show annotation cards"
      />
      <span
        className="relative flex items-center group"
        title="Show or hide annotation cards alongside the editor"
      >
        <svg
          className="w-3.5 h-3.5 text-[color:var(--code-header-text)] opacity-35 group-hover:opacity-60 transition-opacity pointer-events-none"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="10" />
          <text
            x="10"
            y="14.5"
            textAnchor="middle"
            fill="var(--code-header-bg)"
            fontSize="13"
            fontWeight="700"
            fontFamily="sans-serif"
          >
            ?
          </text>
        </svg>
      </span>
    </div>
  );
}

interface EditorPanelProps {
  editorRef: RefObject<HTMLDivElement | null>;
  fileName: string;
  chapterLabel: string;
  multipleChapters: boolean;
  showCards: boolean;
  saveErrorMessage: string;
  onToggleCards: () => void;
}

function EditorPanel(props: EditorPanelProps) {
  return (
    <div className="flex-[3] min-w-0 max-w-[780px] bg-[var(--code-bg)] border border-[var(--code-border)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-2)] bg-[var(--code-header-bg)] text-[color:var(--code-header-text)]">
        {props.multipleChapters ? (
          <MathText
            className="min-w-0 overflow-hidden font-[var(--numina-font-sans)] text-[length:var(--text-sm)] font-[var(--font-weight-medium)] text-[color:var(--text-primary)] text-ellipsis whitespace-nowrap"
            text={props.chapterLabel}
          />
        ) : <span>{props.fileName}</span>}
        <AnnotationToggle checked={props.showCards} onChange={props.onToggleCards} />
      </div>
      {props.saveErrorMessage ? (
        <div className="px-[var(--space-4)] py-[var(--space-2)] font-[var(--numina-font-sans)] text-[length:var(--text-sm)] text-[color:var(--build-error)] border-t border-[var(--code-border)]">
          {props.saveErrorMessage}
        </div>
      ) : null}
      <div ref={props.editorRef} className="edit-editor" />
    </div>
  );
}

function editBodyClass(showAnnotations: boolean, layoutReady: boolean): string {
  return [
    'flex gap-[var(--space-6)]',
    !showAnnotations ? 'max-w-[780px]' : '',
    showAnnotations && !layoutReady ? 'invisible pointer-events-none' : '',
  ].filter(Boolean).join(' ');
}

function useEditModeController(props: EditModeProps) {
  const blueprintReadonly = props.blueprintReadonly ?? false;
  const view = useDerivedView(props);
  const editor = useEditModeEditor({
    collaboration: props.collaboration,
    latexSource: props.latexSource,
    onSourceChange: props.onSourceChange,
    blueprintReadonly,
    declarationSegments: view.declarationSegments,
    showAnnotations: view.showAnnotations,
    active: props.active,
  });
  const saveErrorMessage = useEditModeSave({
    latexSource: props.latexSource,
    activeChapterPath: props.chapter.activeChapterPath,
    blueprintReadonly,
    saveActiveChapter: props.chapter.saveActiveChapter,
    hasContext: props.context !== null,
    collaborative: props.collaboration !== null,
    editSaveState: props.editSaveState ?? null,
  });
  const rootStyle: CSSProperties = {
    maxWidth: view.showAnnotations ? '1200px' : '768px',
    ['--half-w' as string]: '384px',
  };
  return { view, editor, saveErrorMessage, rootStyle };
}

function EditModeInner(props: EditModeProps) {
  const { view, editor, saveErrorMessage, rootStyle } = useEditModeController(props);
  return (
    <div ref={editor.rootRef} className="mx-auto w-full px-6 py-6" style={rootStyle}>
      <div className={editBodyClass(view.showAnnotations, editor.layoutReady)}>
        <EditorPanel
          editorRef={editor.editorContainerRef}
          fileName={view.blueprintFileName}
          chapterLabel={view.activeChapterLabel}
          multipleChapters={props.chapter.hasMultipleChapters}
          showCards={props.showCards}
          saveErrorMessage={saveErrorMessage}
          onToggleCards={() => props.onShowCardsChange(!props.showCards)}
        />
        {view.showAnnotations ? (
          <EditModeAnnotations
            segments={view.declarationSegments}
            blueprint={props.blueprint}
            topByKey={editor.cardTopByDeclKey}
            scheduleLayout={editor.scheduleLayout}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Collaboration document identity forces a fresh editor binding after remounts. */
export default function EditMode(props: EditModeProps) {
  const collaborationKey = props.collaboration?.doc.guid ?? 'plain';
  return <EditModeInner key={collaborationKey} {...props} />;
}
