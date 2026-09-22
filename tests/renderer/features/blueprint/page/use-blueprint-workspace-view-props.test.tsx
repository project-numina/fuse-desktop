import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/features/blueprint/hooks/use-lean-card-panel', () => ({
  useLeanCardPanel: () => ({
    leanCardCollapsed: false, leanCardWidth: 360,
    setLeanCardCollapsed: vi.fn(), onLeanResizeStart: vi.fn(),
  }),
}));
vi.mock('@/lib/lean-setup-events', () => ({ openLeanSetup: vi.fn() }));
vi.mock('@/features/blueprint/components/SourceMode', () => ({ default: () => null }));

import { useBlueprintWorkspaceViewProps } from '@/features/blueprint/page/use-blueprint-workspace-view-props';

it('maps controller state and actions into mode component props', () => {
  const addDraftAttachment = vi.fn();
  const setBlueprint = vi.fn();
  const controller = {
    route: { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' },
    chat: { state: { viewingConversationId: null, conversationId: 'chat-1', currentJobId: null, status: 'idle' } },
    loader: {
      blueprint: { id: 'fermat', name: 'Fermat', blueprint_file: 'blueprint.tex' },
      blueprintLabel: 'Fermat', loading: false, error: null, canEdit: true, setBlueprint,
    },
    modeRouting: {
      mode: 'home', mountedModes: new Set(['home']), location: { hash: '' },
      navigateHash: vi.fn(), handleModeChange: vi.fn(), navigate: vi.fn(),
    },
    editing: {
      parsedEntries: [], graphEntries: [], latexSource: 'source', latexSegments: [],
      setLatexSource: vi.fn(), selectChapter: vi.fn(), editSaveState: {},
      editFlushRef: { current: null }, hasUncommittedChanges: false,
      applySettingsUpdate: vi.fn(),
      chapter: {
        hasMultipleChapters: false, chapters: [], activeChapterPath: '',
        chapterContent: '', loadChapter: vi.fn(), saveActiveChapter: vi.fn(),
        restoredFromStorage: false, userNavigated: false,
      },
    },
    files: {
      directory: { error: null, directories: [], loading: false },
      projectDirectory: 'Project', showingReference: false, selectedFile: 'Project/Main.lean',
      selectedFileIsLean: true, availableFiles: ['Project/Main.lean'],
      setSelectedFile: vi.fn(), setBrowserPath: vi.fn(), setBrowserDirectory: vi.fn(),
      selectFile: vi.fn(), openFile: vi.fn(), loadOpenFile: vi.fn(),
      infoview: {
        state: {}, flushPendingSave: vi.fn(async () => true), reloadFile: vi.fn(),
        updateCursor: vi.fn(), hover: vi.fn(),
      },
      fileContent: 'content', fileLoading: false, fileError: false,
      handleContentChange: vi.fn(), pendingJumpTarget: null,
      setPendingJumpTarget: vi.fn(), handleDiagnosticJump: vi.fn(),
    },
    sources: {
      visibleSources: [], loading: false, loadFailed: false, selectedSourceId: '', loaded: true,
      openContextAttachment: vi.fn(), draftAttachments: [], setDraftAttachments: vi.fn(),
      handleSourceUploaded: vi.fn(), addDraftAttachment,
    },
    refresh: {
      events: { ocrStatus: null, buildErrors: {} }, handleSourceUpdated: vi.fn(),
    },
    chatRouting: { handleNewChat: vi.fn(), handleSelectHistorySession: vi.fn() },
  };

  const { result } = renderHook(() => useBlueprintWorkspaceViewProps(controller as never));
  expect(result.current.blueprintLabel).toBe('Fermat');
  expect(result.current.homeProps.onOpenLeanFile).toBe(controller.files.openFile);
  expect(result.current.historyProps.activeSessionId).toBe('chat-1');

  act(() => result.current.leanProps.onAttachFile?.());
  expect(addDraftAttachment).toHaveBeenCalledWith(expect.objectContaining({
    repo_path: 'Project/Main.lean', selection: { kind: 'entire_file' },
  }));
  act(() => result.current.settingsProps.onProjectUpdated?.('NewProject'));
  expect(setBlueprint).toHaveBeenCalledWith(expect.any(Function));
});
