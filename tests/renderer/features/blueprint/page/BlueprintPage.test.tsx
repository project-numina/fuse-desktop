import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const chapter = {
    chapters: [] as Array<{ path: string; label: string; isEntrypoint: boolean }>,
    hasMultipleChapters: false,
    activeChapterPath: '',
    chapterContent: '',
    restoredFromStorage: false,
    userNavigated: false,
    syncActiveFromBlueprint: vi.fn<() => string | null>(() => null),
    loadChapter: vi.fn(async () => true),
    saveActiveChapter: vi.fn(async () => true),
    markUserNavigated: vi.fn(),
  };
  const chat = {
    state: {
      sessionId: null as string | null,
      conversationId: null as string | null,
      viewingConversationId: null as string | null,
      currentJobId: null as string | null,
      status: 'idle',
    },
    prepareNewAgentSession: vi.fn(async () => undefined),
    loadHistory: vi.fn(async () => undefined),
  };
  const pageStore: {
    state: { blueprint: Record<string, unknown> | null; error: string | null };
    load: ReturnType<typeof vi.fn>;
  } = {
    state: { blueprint: null, error: null },
    load: vi.fn(async () => undefined),
  };

  return {
    route: { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat', mode: undefined as string | undefined },
    location: { pathname: '/repo/acme/mathlib/blueprint/fermat', search: '', hash: '' },
    fileParam: null as string | null,
    pageStore,
    chapter,
    chat,
    navigate: vi.fn(),
    setSearchParams: vi.fn(),
    setDocumentTitle: vi.fn(),
    setWorkspaceRuntimeTag: vi.fn(),
    openLeanSetup: vi.fn(),
    setLatexSource: vi.fn(),
    initFromBlueprint: vi.fn(),
    applyOcrPhase: vi.fn(),
    fetchBlueprint: vi.fn(),
    fetchRepositorySources: vi.fn(),
    request: vi.fn(),
    chatProvider: vi.fn(),
    homeMode: vi.fn(),
    editMode: vi.fn(),
    leanView: vi.fn(),
    chatPanel: vi.fn(),
    sidebar: vi.fn(),
    sectionSelector: vi.fn(),
    blueprintEventsHook: vi.fn(),
    repositoryDirectoryHook: vi.fn(),
    infoviewHook: vi.fn(),
  };
});

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.route,
  useSearchParams: () => [new URLSearchParams(mocks.location.search), mocks.setSearchParams],
}));

vi.mock('@/lib/route-params', () => ({ useFileParam: () => mocks.fileParam }));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: mocks.setDocumentTitle }));
vi.mock('@/lib/inline-math-text', () => ({
  stripInlineMathDelimiters: (value: string) => value.replaceAll('\\(', '').replaceAll('\\)', ''),
}));
vi.mock('@/features/blueprint/lib/blueprint-helpers', () => ({
  URL_TO_MODE: {
    home: 'home', graph: 'graph', edit: 'edit', files: 'view', view: 'view',
    git: 'git', history: 'history', settings: 'settings', source: 'view',
  },
  formatBlueprintLabel: (id: string) => `Blueprint ${id}`,
  blueprintModeUrl: (base: string, mode: string, search = '', file?: string | null) => {
    const suffix = mode === 'home' ? '' : `/${mode}`;
    const fileSuffix = file ? `/${file}` : '';
    return `${base}${suffix}${fileSuffix}${search ? `?${search.replace(/^\?/, '')}` : ''}`;
  },
  isProjectLeanFile: (file: string | null, project = '') =>
    Boolean(file?.endsWith('.lean') && (!project || file.startsWith(project))),
}));
vi.mock('@/features/blueprint/lib/chapter-entries', () => ({
  singleChapterEntries: (local: unknown[], server: unknown[]) => local.length ? local : server,
  multiChapterEntries: (local: unknown[], server: unknown[]) => local.length ? local : server,
}));
vi.mock('@/lib/api', () => ({
  fetchBlueprint: mocks.fetchBlueprint,
  fetchRepositorySources: mocks.fetchRepositorySources,
  request: mocks.request,
}));
vi.mock('@/features/blueprint/state/blueprint-page', () => ({
  useBlueprintPage: () => mocks.pageStore,
}));
vi.mock('@/state/chat', () => ({
  ChatProvider: ({ children, ...props }: { children: ReactNode; options: unknown }) => {
    mocks.chatProvider(props);
    return <>{children}</>;
  },
  useChat: () => mocks.chat,
}));
vi.mock('@/features/blueprint/hooks/latex-parser', () => ({
  useLatexParser: () => ({
    latexSource: 'parser source',
    setLatexSource: mocks.setLatexSource,
    parsedEntries: [{ label: 'parsed-entry' }],
    latexSegments: [{ type: 'text', content: 'parser source' }],
    initFromBlueprint: mocks.initFromBlueprint,
  }),
}));
vi.mock('@/features/blueprint/hooks/chapter', () => ({ useChapter: () => mocks.chapter }));
vi.mock('@/features/blueprint/hooks/use-collaboration', () => ({
  useCollaboration: () => ({ connected: false, synced: false }),
}));
vi.mock('@/features/blueprint/hooks/events', () => ({
  useBlueprintEvents: (options: unknown) => {
    mocks.blueprintEventsHook(options);
    return { buildErrors: { errors: 0, warnings: 0 }, ocrStatus: null, applyOcrPhase: mocks.applyOcrPhase };
  },
}));
vi.mock('@/features/blueprint/hooks/use-repository-directory', () => ({
  useRepositoryDirectory: (...args: unknown[]) => {
    mocks.repositoryDirectoryHook(...args);
    return {
      files: [{ path: 'Project/Main.lean' }, { path: 'README.md' }],
      directories: ['Project'], loading: false, error: null,
    };
  },
}));
vi.mock('@/features/blueprint/hooks/infoview', () => ({
  useInfoview: (options: unknown) => {
    mocks.infoviewHook(options);
    return {
      state: { setupRequired: false, status: 'ready' },
      flushPendingSave: vi.fn(async () => true),
      getPendingSaveContent: vi.fn(() => undefined),
      reloadFile: vi.fn(async () => undefined),
      updateCursor: vi.fn(),
      saveAndRefresh: vi.fn(),
      hover: vi.fn(),
    };
  },
}));
vi.mock('@/features/blueprint/hooks/use-lean-card-panel', () => ({
  useLeanCardPanel: () => ({
    leanCardCollapsed: false, setLeanCardCollapsed: vi.fn(), leanCardWidth: 360,
    onLeanResizeStart: vi.fn(),
  }),
}));

vi.mock('@/components/layout/AppHeader', () => ({
  default: ({ breadcrumbs, loading }: { breadcrumbs: ReactNode; loading: boolean }) => (
    <header data-loading={String(loading)}>{breadcrumbs}</header>
  ),
}));
vi.mock('@/components/MathText', () => ({
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock('@/desktop/LeanSetupPrompt', () => ({ default: () => <div>Lean setup</div> }));
vi.mock('@/features/chat/components/panel/ChatPanel', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.chatPanel(props);
    const attachments = props.draftAttachments as unknown[];
    return <div data-testid="chat-panel">Chat ({attachments.length} attachments)</div>;
  },
}));
vi.mock('@/features/blueprint/components/BlueprintSidebar', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.sidebar(props);
    return (
      <aside data-testid="sidebar" data-mode={props.mode} data-readonly={String(props.readonly)}>
        <button onClick={() => (props.onModeChange as (mode: string) => void)('edit')}>Open editor</button>
        <button onClick={() => (props.onNewChat as () => void)()}>New chat</button>
      </aside>
    );
  },
}));
vi.mock('@/features/blueprint/components/SectionSelector', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.sectionSelector(props);
    return <div>Section selector</div>;
  },
}));
vi.mock('@/features/blueprint/components/BlueprintEmptyState', () => ({
  default: () => <div>Blueprint empty state</div>,
}));
vi.mock('@/features/blueprint/components/HomeMode', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.homeMode(props);
    return <div>Home mode</div>;
  },
}));
vi.mock('@/features/blueprint/components/GraphMode', () => ({ default: () => <div>Graph mode</div> }));
vi.mock('@/features/blueprint/components/SourceMode', () => ({ default: () => <div>Reference preview</div> }));
vi.mock('@/features/blueprint/components/FileViewer', () => ({
  fileKind: (path: string) => path.endsWith('.pdf') ? 'pdf' : 'text',
}));
vi.mock('@/features/blueprint/components/EditMode', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.editMode(props);
    return <div>Edit mode</div>;
  },
}));
vi.mock('@/features/blueprint/components/LeanView', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.leanView(props);
    return (
      <div>
        <span>Selected: {String(props.selectedFile)}</span>
        <span>Content: {String(props.fileContent)}</span>
        <button onClick={() => (props.onAttachFile as (selection?: unknown) => void)()}>Attach current file</button>
      </div>
    );
  },
}));
vi.mock('@/features/blueprint/components/GitMode', () => ({ default: () => <div>Git mode</div> }));
vi.mock('@/features/blueprint/components/HistoryMode', () => ({ default: () => <div>History mode</div> }));
vi.mock('@/features/blueprint/components/SettingsMode', () => ({ default: () => <div>Settings mode</div> }));
vi.mock('@/features/blueprint/components/git/use-git-mode', () => ({}));
vi.mock('@/lib/lean-setup-events', () => ({
  openLeanSetup: mocks.openLeanSetup,
  LEAN_SETUP_READY_EVENT: 'lean-setup-ready',
}));
vi.mock('@/lib/runtime-routing', () => ({
  runtimeRouteTag: () => null,
  setWorkspaceRuntimeTag: mocks.setWorkspaceRuntimeTag,
}));

import BlueprintPage from '@/features/blueprint/page/BlueprintPage';

function blueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fermat', name: 'Fermat theorem', blueprint_file: 'blueprint.tex',
    blueprint_content: '\\begin{theorem}Fermat\\end{theorem}', can_edit: true,
    entries: [{ label: 'server-entry' }], project_subdir: 'Project',
    runtime_route_tag: 'runtime-42', ocr_phase: 'complete',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.route.owner = 'acme';
  mocks.route.repo = 'mathlib';
  mocks.route.blueprintId = 'fermat';
  mocks.route.mode = undefined;
  mocks.location.pathname = '/repo/acme/mathlib/blueprint/fermat';
  mocks.location.search = '';
  mocks.location.hash = '';
  mocks.fileParam = null;
  mocks.pageStore.state = { blueprint: null, error: null };
  mocks.chapter.chapters = [];
  mocks.chapter.hasMultipleChapters = false;
  mocks.chapter.activeChapterPath = '';
  mocks.chapter.chapterContent = '';
  mocks.chapter.restoredFromStorage = false;
  mocks.chapter.userNavigated = false;
  mocks.chapter.syncActiveFromBlueprint.mockReturnValue(null);
  mocks.chat.state.sessionId = null;
  mocks.chat.state.conversationId = null;
  mocks.chat.state.viewingConversationId = null;
  mocks.chat.state.currentJobId = null;
  mocks.chat.state.status = 'idle';
  mocks.fetchRepositorySources.mockResolvedValue({ sources: [] });
  mocks.fetchBlueprint.mockResolvedValue(blueprint());
  mocks.request.mockResolvedValue({ content: 'theorem demo : True := by trivial' });
});

describe('BlueprintPage', () => {
  it('provides the route identity to chat and loads an uncached blueprint', () => {
    render(<BlueprintPage />);

    expect(screen.getByText('Loading blueprint…')).toBeInTheDocument();
    expect(mocks.pageStore.load).toHaveBeenCalledWith('acme', 'mathlib', 'fermat');
    expect(mocks.chatProvider).toHaveBeenCalledWith({
      options: {
        repositoryOwner: 'acme', repositoryName: 'mathlib', blueprintName: 'fermat',
      },
    });
    expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Blueprint fermat');
  });

  it('renders the store error instead of leaving the loading state active', async () => {
    mocks.pageStore.state = { blueprint: null, error: 'Workspace not found' };
    render(<BlueprintPage />);

    expect(await screen.findByText('Workspace not found')).toBeVisible();
    expect(screen.queryByText('Loading blueprint…')).not.toBeInTheDocument();
  });

  it('initializes a cached workspace and propagates read-only orchestration', async () => {
    mocks.pageStore.state = {
      blueprint: blueprint({ name: '\\(Fermat\\)', can_edit: false }), error: null,
    };
    mocks.chapter.hasMultipleChapters = true;
    mocks.chapter.chapters = [
      { path: 'blueprint.tex', label: 'Main', isEntrypoint: true },
      { path: 'chapter.tex', label: 'Chapter', isEntrypoint: false },
    ];
    mocks.chapter.activeChapterPath = 'blueprint.tex';
    mocks.chapter.chapterContent = 'chapter content';

    const view = render(<BlueprintPage />);

    expect(await screen.findByText('Home mode')).toBeVisible();
    expect(mocks.pageStore.load).not.toHaveBeenCalled();
    expect(mocks.setLatexSource).toHaveBeenCalledWith('\\begin{theorem}Fermat\\end{theorem}');
    expect(mocks.applyOcrPhase).toHaveBeenCalledWith('complete');
    expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Fermat');
    expect(screen.getByText('Read-only')).toHaveAttribute('title', 'This workspace is read-only.');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByText('Section selector')).toBeVisible();
    expect(mocks.chatPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      blueprintReadonly: true, owner: 'acme', repository: 'mathlib', blueprintId: 'fermat',
    }));
    expect(mocks.setWorkspaceRuntimeTag).toHaveBeenCalledWith(
      'acme', 'mathlib', 'fermat', 'runtime-42',
    );

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(mocks.chat.prepareNewAgentSession).not.toHaveBeenCalled();

    view.unmount();
    expect(mocks.setWorkspaceRuntimeTag).toHaveBeenLastCalledWith(
      'acme', 'mathlib', 'fermat', null,
    );
  });

  it('routes mode changes and shows the editor empty state only without a blueprint file', async () => {
    mocks.route.mode = 'edit';
    mocks.location.pathname += '/edit';
    mocks.location.search = '?chat=existing';
    mocks.pageStore.state = { blueprint: blueprint({ blueprint_file: undefined }), error: null };
    render(<BlueprintPage />);

    expect(await screen.findByText('Blueprint empty state')).toBeVisible();
    expect(screen.queryByText('Edit mode')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/repo/acme/mathlib/blueprint/fermat/edit?chat=existing',
    );
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(mocks.chat.prepareNewAgentSession).toHaveBeenCalledOnce();
    const [nextParams, options] = mocks.setSearchParams.mock.calls.at(-1)!;
    expect((nextParams as URLSearchParams).has('chat')).toBe(false);
    expect(options).toEqual({ replace: true });
  });

  it('loads the selected repository file and exposes it to chat attachments', async () => {
    mocks.route.mode = 'view';
    mocks.location.pathname += '/view/Project/Main.lean';
    mocks.fileParam = 'Project/Main.lean';
    mocks.pageStore.state = { blueprint: blueprint(), error: null };
    mocks.fetchRepositorySources.mockResolvedValue({
      sources: [
        { id: 'global', display_name: 'Global notes', metadata: {} },
        { id: 'mine', display_name: 'Fermat notes', metadata: { project_scoped: true, scoped_blueprint_id: 'fermat' } },
        { id: 'other', display_name: 'Other notes', metadata: { project_scoped: true, scoped_blueprint_id: 'other' } },
      ],
    });
    render(<BlueprintPage />);

    expect(await screen.findByText('Content: theorem demo : True := by trivial')).toBeVisible();
    expect(mocks.repositoryDirectoryHook).toHaveBeenCalledWith(
      'acme', 'mathlib', 'fermat', 'Project', true,
    );
    expect(mocks.request).toHaveBeenCalledWith(
      '/repositories/acme/mathlib/files/Project/Main.lean?ref=numina%2Ffermat',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.leanView).toHaveBeenLastCalledWith(expect.objectContaining({
      selectedFile: 'Project/Main.lean',
      fileContent: 'theorem demo : True := by trivial',
      readonly: false,
      files: ['Project/Main.lean', 'README.md'],
    }));
    await waitFor(() => expect(mocks.chatPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      availableSources: [
        expect.objectContaining({ id: 'global' }),
        expect.objectContaining({ id: 'mine' }),
      ],
    })));

    fireEvent.click(screen.getByRole('button', { name: 'Attach current file' }));
    expect(await screen.findByText('Chat (1 attachments)')).toBeVisible();
    expect(mocks.chatPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      draftAttachments: [{
        attachment_kind: 'repo_file', repo_path: 'Project/Main.lean',
        display_name: 'Main.lean', selection: { kind: 'entire_file' },
      }],
    }));
  });
});
