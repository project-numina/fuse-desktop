import { useCallback, useState, type ComponentProps } from 'react';

import type { BlueprintMode, SidebarOcrStatus } from '@/features/blueprint/components/BlueprintSidebar';
import type { EditModeBlueprint } from '@/features/blueprint/components/EditMode';
import type { GitBlueprint } from '@/features/blueprint/components/git/use-git-mode';
import type {
  BlueprintEntry as HomeModeEntry,
  HomeModeBlueprint,
} from '@/features/blueprint/components/HomeMode';
import type { LeanViewBlueprint } from '@/features/blueprint/components/LeanView';
import type { BlueprintRef } from '@/features/blueprint/components/SettingsMode';
import SourceMode, { type SourceModeBlueprint } from '@/features/blueprint/components/SourceMode';
import { useLeanCardPanel } from '@/features/blueprint/hooks/use-lean-card-panel';
import { openLeanSetup } from '@/lib/lean-setup-events';

import BlueprintWorkspaceView from './BlueprintWorkspaceView';
import ImportedReferencesFooter from './ImportedReferencesFooter';
import type { BlueprintWorkspaceController } from './use-blueprint-workspace';

const SECTION_SELECTOR_MODES: BlueprintMode[] = ['home', 'graph', 'edit'];
const READONLY_MESSAGE = 'This workspace is read-only.';

type ViewProps = ComponentProps<typeof BlueprintWorkspaceView>;
type LeanCardPanel = ReturnType<typeof useLeanCardPanel>;

function rawFileUrl(owner: string, repo: string, file: string | null): string | undefined {
  if (!file) return undefined;
  const path = file.split('/').map(encodeURIComponent).join('/');
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/files-raw/${path}`;
}

function useProjectViewActions(controller: BlueprintWorkspaceController) {
  const { loader, editing, files, refresh } = controller;
  const { setBlueprint } = loader;
  const { editFlushRef } = editing;
  const { setSelectedFile, setBrowserPath } = files;
  const { flushPendingSave } = files.infoview;
  const { handleSourceUpdated } = refresh;
  const beforeProjectChange = useCallback(async () => {
    if ((await flushPendingSave(false)) === false) return false;
    return (await editFlushRef.current?.()) ?? true;
  }, [flushPendingSave, editFlushRef]);
  const onProjectUpdated = useCallback((directory: string) => {
    setSelectedFile(null);
    setBrowserPath(null);
    setBlueprint((previous) => previous
      ? { ...previous, project_subdir: directory }
      : previous);
    handleSourceUpdated();
  }, [setSelectedFile, setBrowserPath, setBlueprint, handleSourceUpdated]);
  return { beforeProjectChange, onProjectUpdated };
}

function useFileViewActions(controller: BlueprintWorkspaceController) {
  const { files, sources } = controller;
  const { selectedFile, selectedFileIsLean, loadOpenFile } = files;
  const { reloadFile } = files.infoview;
  const { addDraftAttachment } = sources;
  const onAttachFile = useCallback((selection?: { start_line: number; end_line: number }) => {
    if (!selectedFile) return;
    addDraftAttachment({
      attachment_kind: 'repo_file',
      repo_path: selectedFile,
      display_name: selectedFile.split('/').pop(),
      selection: selection ? { kind: 'line_range', ...selection } : { kind: 'entire_file' },
    });
  }, [selectedFile, addDraftAttachment]);
  const onReloadFile = useCallback(async () => {
    if (selectedFileIsLean) await reloadFile();
    await loadOpenFile({ silent: true });
  }, [selectedFileIsLean, reloadFile, loadOpenFile]);
  return { onAttachFile, onReloadFile };
}

type WorkspaceViewActions = ReturnType<typeof useProjectViewActions>
  & ReturnType<typeof useFileViewActions>;

function buildShellProps(controller: BlueprintWorkspaceController) {
  const { route, loader, modeRouting, files, refresh, chatRouting } = controller;
  return {
    route,
    blueprint: loader.blueprint,
    blueprintLabel: loader.blueprintLabel,
    loading: loader.loading,
    error: loader.error,
    canEdit: loader.canEdit,
    mode: modeRouting.mode,
    mountedModes: modeRouting.mountedModes,
    projectDirectory: files.projectDirectory,
    sidebarOcrStatus: (refresh.events.ocrStatus ?? 'not_started') as SidebarOcrStatus,
    onModeChange: modeRouting.handleModeChange,
    onNewChat: chatRouting.handleNewChat,
  };
}

function buildChatProps(
  controller: BlueprintWorkspaceController,
  isReadonly: boolean,
): ViewProps['chatProps'] {
  const { route, loader, files, sources } = controller;
  return {
    blueprintReadonly: isReadonly,
    chatReadonlyMessage: READONLY_MESSAGE,
    macros: loader.blueprint?.latex_macros,
    owner: route.owner,
    repository: route.repo,
    blueprintId: route.blueprintId,
    availableSources: sources.loaded ? sources.visibleSources : undefined,
    draftAttachments: sources.draftAttachments,
    onDraftAttachmentsChange: sources.setDraftAttachments,
    onSourceUploaded: sources.handleSourceUploaded,
    onOpenContextAttachment: sources.openContextAttachment,
    availableFilePaths: files.availableFiles,
    onOpenFile: files.openFile,
  };
}

function buildHomeProps(controller: BlueprintWorkspaceController): ViewProps['homeProps'] {
  const { loader, editing, files, modeRouting } = controller;
  return {
    blueprint: loader.blueprint as unknown as HomeModeBlueprint,
    entries: editing.parsedEntries as unknown as HomeModeEntry[],
    hasMultipleChapters: editing.chapter.hasMultipleChapters,
    chapters: editing.chapter.chapters,
    activeChapterPath: editing.chapter.activeChapterPath,
    chapterContent: editing.chapter.chapterContent,
    onSelectChapter: editing.selectChapter,
    onOpenLeanFile: files.openFile,
    currentHash: modeRouting.location.hash,
    onNavigateHash: modeRouting.navigateHash,
    onAutoSelectChapter: editing.chapter.loadChapter,
    restoredFromStorage: editing.chapter.restoredFromStorage,
    userNavigated: editing.chapter.userNavigated,
  };
}

function buildEditProps(
  controller: BlueprintWorkspaceController,
  showCards: boolean,
  onShowCardsChange: (show: boolean) => void,
): ViewProps['editProps'] {
  const { route, loader, modeRouting, editing } = controller;
  return {
    blueprint: loader.blueprint as unknown as EditModeBlueprint,
    collaboration: null,
    latexSource: editing.latexSource,
    latexSegments: editing.latexSegments,
    onSourceChange: editing.setLatexSource,
    chapter: {
      chapters: editing.chapter.chapters,
      hasMultipleChapters: editing.chapter.hasMultipleChapters,
      activeChapterPath: editing.chapter.activeChapterPath,
      saveActiveChapter: editing.chapter.saveActiveChapter,
    },
    context: route,
    showCards,
    onShowCardsChange,
    active: modeRouting.mode === 'edit',
    blueprintReadonly: !loader.canEdit,
    editSaveState: editing.editSaveState,
  };
}

function buildBlueprintModeProps(
  controller: BlueprintWorkspaceController,
  showCards: boolean,
  onShowCardsChange: (show: boolean) => void,
) {
  const { route, loader, modeRouting, editing, refresh } = controller;
  return {
    homeProps: buildHomeProps(controller),
    graphProps: {
      parsedEntries: editing.graphEntries,
      activeChapterPath: editing.chapter.activeChapterPath,
      isActive: modeRouting.mode === 'graph',
      latexMacros: loader.blueprint?.latex_macros,
    },
    emptyProps: {
      ...route,
      readonly: !loader.canEdit,
      readonlyMessage: READONLY_MESSAGE,
      onBlueprintReady: refresh.handleSourceUpdated,
    },
    editProps: buildEditProps(controller, showCards, onShowCardsChange),
    gitProps: {
      blueprint: loader.blueprint as unknown as GitBlueprint,
      context: route,
      active: modeRouting.mode === 'git',
      hasUncommittedChanges: editing.hasUncommittedChanges,
    },
  } satisfies Pick<ViewProps, 'homeProps' | 'graphProps' | 'emptyProps' | 'editProps' | 'gitProps'>;
}

function buildHistoryProps(controller: BlueprintWorkspaceController): ViewProps['historyProps'] {
  const { route, chat, loader, chatRouting } = controller;
  return {
    ...route,
    onSelectSession: chatRouting.handleSelectHistorySession,
    onNewChat: chatRouting.handleNewChat,
    readOnly: !loader.canEdit,
    activeSessionId: chat.state.viewingConversationId ?? chat.state.conversationId,
    currentJobId: chat.state.currentJobId,
    sessionStatus: chat.state.status,
  };
}

function buildSettingsProps(
  controller: BlueprintWorkspaceController,
  actions: WorkspaceViewActions,
): ViewProps['settingsProps'] {
  const { route, loader, modeRouting, editing, refresh } = controller;
  return {
    blueprint: loader.blueprint as unknown as BlueprintRef,
    ...route,
    readonly: !loader.canEdit,
    readonlyReason: READONLY_MESSAGE,
    onUpdated: editing.applySettingsUpdate,
    onSourceUpdated: refresh.handleSourceUpdated,
    beforeProjectChange: actions.beforeProjectChange,
    onProjectUpdated: actions.onProjectUpdated,
    onRemoved: () => modeRouting.navigate(`/repo/${route.owner}/${route.repo}`, { replace: true }),
  };
}

function buildFilePanelFooter(controller: BlueprintWorkspaceController) {
  const { files, sources } = controller;
  const showFooter = Boolean(files.directory.error || sources.visibleSources.length > 0
    || sources.loading || sources.loadFailed);
  if (!showFooter) return undefined;
  return (
    <ImportedReferencesFooter
      filesError={files.directory.error}
      sources={sources.visibleSources}
      loading={sources.loading}
      loadFailed={sources.loadFailed}
      showingReference={files.showingReference}
      selectedSourceId={sources.selectedSourceId}
      onOpenSource={(sourceId) => sources.openContextAttachment({
        attachment_kind: 'backend_source', source_id: sourceId,
      })}
    />
  );
}

function buildReferencePreview(controller: BlueprintWorkspaceController) {
  const { route, loader, files, sources } = controller;
  if (!files.showingReference) return undefined;
  return (
    <SourceMode
      blueprint={loader.blueprint as unknown as SourceModeBlueprint}
      repositorySources={sources.visibleSources}
      selectedSourceId={sources.selectedSourceId}
      {...route}
      onAttachContext={sources.addDraftAttachment}
    />
  );
}

function buildLeanFileProps(controller: BlueprintWorkspaceController) {
  const { route, loader, files } = controller;
  return {
    blueprint: loader.blueprint as unknown as LeanViewBlueprint,
    selectedFile: files.selectedFile,
    onSelectedFileChange: files.selectFile,
    files: files.availableFiles,
    directories: files.directory.directories,
    filesLoading: files.directory.loading,
    onDirectoryChange: files.setBrowserDirectory,
    filePanelFooter: buildFilePanelFooter(controller),
    referencePreview: buildReferencePreview(controller),
    fileUrl: rawFileUrl(route.owner, route.repo, files.selectedFile),
    fileContent: files.fileContent,
    fileLoading: files.fileLoading,
    fileError: files.fileError,
    readonly: !loader.canEdit || !files.selectedFileIsLean,
    onFileContentChange: files.handleContentChange,
  };
}

function buildLeanInteractionProps(
  controller: BlueprintWorkspaceController,
  actions: WorkspaceViewActions,
  leanCard: LeanCardPanel,
) {
  const { route, files, refresh } = controller;
  const jumpTarget = files.pendingJumpTarget?.file === files.selectedFile
    ? files.pendingJumpTarget : null;
  return {
    infoview: files.selectedFileIsLean ? { state: files.infoview.state } : null,
    onAttachFile: actions.onAttachFile,
    buildErrorCounts: refresh.events.buildErrors,
    onCursorChange: files.infoview.updateCursor,
    leanHover: files.infoview.hover,
    onSetupLean: () => openLeanSetup(route),
    onReloadFile: actions.onReloadFile,
    jumpToLine: jumpTarget?.line ?? 0,
    jumpToColumn: jumpTarget?.column ?? 1,
    onJumped: () => files.setPendingJumpTarget(null),
    onJump: files.handleDiagnosticJump,
    panelCollapsed: leanCard.leanCardCollapsed,
    panelWidth: leanCard.leanCardWidth,
    onPanelCollapsedChange: leanCard.setLeanCardCollapsed,
    onPanelResizeStart: leanCard.onLeanResizeStart,
  };
}

function buildLeanProps(
  controller: BlueprintWorkspaceController,
  actions: WorkspaceViewActions,
  leanCard: LeanCardPanel,
): ViewProps['leanProps'] {
  return {
    ...buildLeanFileProps(controller),
    ...buildLeanInteractionProps(controller, actions, leanCard),
  };
}

function buildSectionProps(controller: BlueprintWorkspaceController) {
  const { editing, modeRouting } = controller;
  return {
    showSectionSelector: editing.chapter.hasMultipleChapters
      && SECTION_SELECTOR_MODES.includes(modeRouting.mode),
    sectionProps: {
      chapters: editing.chapter.chapters,
      activePath: editing.chapter.activeChapterPath,
      onSelect: editing.selectChapter,
    },
  } satisfies Pick<ViewProps, 'showSectionSelector' | 'sectionProps'>;
}

export function useBlueprintWorkspaceViewProps(
  controller: BlueprintWorkspaceController,
): ViewProps {
  const [showCards, setShowCards] = useState(true);
  const leanCard = useLeanCardPanel();
  const actions = {
    ...useProjectViewActions(controller),
    ...useFileViewActions(controller),
  };

  return {
    ...buildShellProps(controller),
    chatProps: buildChatProps(controller, !controller.loader.canEdit),
    ...buildBlueprintModeProps(controller, showCards, setShowCards),
    historyProps: buildHistoryProps(controller),
    settingsProps: buildSettingsProps(controller, actions),
    leanProps: buildLeanProps(controller, actions, leanCard),
    ...buildSectionProps(controller),
  };
}
