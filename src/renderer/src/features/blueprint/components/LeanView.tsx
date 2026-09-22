/**
 * Blueprint Lean view: a centered, scrollable code column showing the selected
 * Lean file, plus a resizable right rail hosting the Files list and Infoview.
 *
 * The page supplies the blueprint, live Infoview state, selected-file content,
 * and controlled selection. This view composes `FileViewer`, `InfoviewPanel`,
 * and `ChangedFilesPanel`, and delegates edits, caret moves, caret jumps, and
 * reloads through page callbacks — the page owns the autosave and the Infoview
 * machine.
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

import type { InfoviewState } from '@/features/blueprint/hooks/infoview';
import LeanEmptyState from '@/features/blueprint/components/LeanEmptyState';
import FileViewer from '@/features/blueprint/components/FileViewer';
import ChangedFilesPanel, {
  type BuildErrorCount,
  type FileDiffStats,
} from '@/features/blueprint/components/ChangedFilesPanel';
import InfoviewPanel from '@/features/blueprint/components/InfoviewPanel';
import type { LeanHoverFetcher } from '@/features/blueprint/lib/lean-hover';

/**
 * Live Lean services for the authenticated workspace. Null on the public
 * read-only share, where the Lean LSP is unreachable and file text is supplied
 * via `content` instead. Only `state` is consumed by this view; the machine's
 * cursor and save entry points are page-owned and reach the editor through the
 * `onCursorChange` / `onFileContentChange` callbacks.
 */
export interface LeanInfoview {
  state: InfoviewState;
}

export interface LeanViewBlueprint {
  id?: string;
  project_subdir?: string;
  all_lean_files?: string[];
  lean_files?: string[];
  file_diff_stats?: Record<string, FileDiffStats>;
}

export interface LeanViewProps {
  blueprint: LeanViewBlueprint;
  files?: string[];
  directories?: string[];
  filesLoading?: boolean;
  onDirectoryChange?: (path: string) => void;
  filePanelFooter?: ReactNode;
  referencePreview?: ReactNode;
  onAttachFile?: (selection?: { start_line: number; end_line: number }) => void;
  /** Controlled selected file path. */
  selectedFile: string | null;
  onSelectedFileChange: (value: string | null) => void;
  /** Live Infoview state for the rail; null for the public read-only share. */
  infoview?: LeanInfoview | null;
  /** Per-file build error/warning counts for the rail (page-owned). */
  buildErrorCounts?: Record<string, BuildErrorCount>;
  /** Selected file's text content for the viewer (page-fetched). */
  fileContent?: string;
  fileLoading?: boolean;
  fileError?: boolean;
  /** Optional external link shown from the viewer header (unused on the desktop). */
  fileGithubUrl?: string;
  /** Embeddable URL for PDF/binary previews in the viewer. */
  fileUrl?: string;
  /** Reload affordance for the viewer (re-fetch / re-elaborate imports). */
  onReloadFile?: () => void | Promise<void>;
  /** Opens the setup confirmation without starting a build. */
  onSetupLean?: () => void;
  /**
   * Read-only Lean buffer. True for a merged or non-writable workspace and for
   * the public share; the editor then rejects input and reports no edits.
   */
  readonly?: boolean;
  /** Reports an edit to the open Lean file (page-owned autosave). */
  onFileContentChange?: (value: string) => void;
  /** Reports the caret so the page can drive goals/diagnostics for it. */
  onCursorChange?: (line: number, column: number) => void;
  /**
   * Queries the Lean LSP for hover info, giving the editor VSCode-Lean4-style
   * signature/docstring popups. Omitted on the public share, which has no LSP.
   */
  leanHover?: LeanHoverFetcher;
  /** Jump the editor caret to a diagnostic's (line, column). Page-handled
   *  because the presentational FileViewer does not expose a caret API. */
  onJump?: (payload: { line: number; column: number }) => void;
  /** 1-based position requested by a declaration link or diagnostic. */
  jumpToLine?: number;
  jumpToColumn?: number;
  onJumped?: () => void;
  panelCollapsed: boolean;
  panelWidth: number;
  onPanelCollapsedChange: (collapsed: boolean) => void;
  onPanelResizeStart: (event: React.MouseEvent) => void;
}

export default function LeanView({
  blueprint,
  files: repositoryFiles,
  directories,
  filesLoading,
  onDirectoryChange,
  filePanelFooter,
  referencePreview,
  onAttachFile,
  selectedFile,
  onSelectedFileChange,
  infoview = null,
  buildErrorCounts,
  fileContent = '',
  fileLoading = false,
  fileError = false,
  fileGithubUrl,
  fileUrl,
  onReloadFile,
  onSetupLean,
  readonly = true,
  onFileContentChange,
  onCursorChange,
  leanHover,
  onJump,
  jumpToLine = 0,
  jumpToColumn = 1,
  onJumped,
  panelCollapsed,
  panelWidth,
  onPanelCollapsedChange,
  onPanelResizeStart,
}: LeanViewProps) {
  // File paths stay repository-relative, while the panel treats the selected
  // Lean project as its visible navigation root.
  const files = useMemo<string[]>(() => {
    if (repositoryFiles) return repositoryFiles;
    const all = blueprint.all_lean_files;
    if (all && all.length > 0) return all;
    return blueprint.lean_files || [];
  }, [repositoryFiles, blueprint.all_lean_files, blueprint.lean_files]);

  const diffStats = useMemo(
    () => blueprint.file_diff_stats || {},
    [blueprint.file_diff_stats],
  );

  const isLean = !referencePreview && selectedFile?.endsWith('.lean') === true;
  const setupRequired = isLean && infoview?.state.setupRequired === true;

  const infoviewNode = useMemo(() => {
    if (!infoview) return undefined;
    const state = infoview.state;
    return (
      <InfoviewPanel
        goals={state.goals}
        goalsBefore={state.goalsBefore}
        goalsAfter={state.goalsAfter}
        expectedType={state.expectedType}
        lineContext={state.lineContext}
        diagnostics={state.diagnostics}
        diagnosticsIncomplete={state.diagnosticsIncomplete}
        loading={state.loading}
        error={state.setupRequired ? 'Set up Lean to enable proof goals and live checking.' : state.error}
        onSetupLean={state.setupRequired ? onSetupLean : undefined}
        onJump={onJump}
      />
    );
  }, [infoview, onJump, onSetupLean]);

  const handleSelectFile = useCallback(
    (path: string) => onSelectedFileChange(path),
    [onSelectedFileChange],
  );

  return (
    <div className="flex h-full flex-1 min-w-0 min-h-0">
      {/* Code pane fills the centered column; the Files/Infoview panel lives in
          a resizable right rail pinned to the viewport edge. */}
      <div className="flex-1 min-w-0 min-h-0 h-full overflow-y-auto [overscroll-behavior-y:contain] [scrollbar-gutter:stable_both-edges] [overflow-anchor:none]">
        {!selectedFile && !referencePreview ? <LeanEmptyState /> : (
        <div className="max-w-[800px] mx-auto px-[var(--space-6)] w-full">
          <div className="flex flex-col">
            <div className="min-w-0 py-[var(--space-6)]">
              {setupRequired && (
                <section role="status" className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-background p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Set up Lean to enable live checking</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Proof goals and hover information need a prepared project. You can still browse and edit files. Setup may download dependencies and use disk space.</p>
                  </div>
                  {onSetupLean && <Button onClick={onSetupLean}>Set up Lean</Button>}
                </section>
              )}
              {referencePreview || (selectedFile ? (
                <FileViewer
                  filePath={selectedFile}
                  content={fileContent}
                  loading={fileLoading}
                  error={fileError}
                  githubUrl={fileGithubUrl}
                  fileUrl={fileUrl}
                  onAttachFile={onAttachFile}
                  onReload={setupRequired ? undefined : onReloadFile}
                  readonly={readonly}
                  onChange={onFileContentChange}
                  onCursorChange={onCursorChange}
                  leanHover={setupRequired || !isLean ? undefined : leanHover}
                  jumpToLine={jumpToLine}
                  jumpToColumn={jumpToColumn}
                  onJumped={onJumped}
                />
              ) : null)}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Resizable right rail for the Files/Infoview panel. */}
      <aside
        className={`relative shrink-0 h-full bg-[var(--numina-card-bg)] border-l border-[var(--numina-border-light)] flex flex-col ${
          panelCollapsed ? 'hidden' : ''
        }`}
        style={{ width: `${panelWidth}px` }}
      >
        <div
          className="absolute top-0 bottom-0 -left-[3px] w-[6px] cursor-col-resize z-[2] transition-colors hover:bg-[var(--numina-accent)]/50 active:bg-[var(--numina-accent)]/50"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize files panel"
          onMouseDown={onPanelResizeStart}
        />
        <ChangedFilesPanel
          files={files}
          directories={directories}
          loading={filesLoading}
          onDirectoryChange={onDirectoryChange}
          rootPath={blueprint.project_subdir || ''}
          footer={filePanelFooter}
          diffStats={diffStats}
          buildErrorCounts={buildErrorCounts}
          selectedFile={selectedFile}
          collapsed={false}
          rail
          infoview={isLean ? infoviewNode : undefined}
          onSelectFile={handleSelectFile}
          onToggleCollapsed={() => onPanelCollapsedChange(true)}
        />
      </aside>

      {/* Edge handle for reopening the panel after it's been hidden. */}
      <div className={panelCollapsed ? '' : 'hidden'}>
        <ChangedFilesPanel
          files={[]}
          diffStats={{}}
          selectedFile={null}
          collapsed
          onSelectFile={handleSelectFile}
          onToggleCollapsed={() => onPanelCollapsedChange(false)}
        />
      </div>
    </div>
  );
}
