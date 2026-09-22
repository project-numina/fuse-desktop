import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: '/workspace/view/Project/Main.lean', search: '', hash: '' },
  fileParam: 'Project/Main.lean' as string | null,
  request: vi.fn(),
  getPendingSaveContent: vi.fn(),
  reloadFile: vi.fn(async () => undefined),
  saveAndRefresh: vi.fn(),
  updateCursor: vi.fn(),
  hover: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/lib/route-params', () => ({ useFileParam: () => mocks.fileParam }));
vi.mock('@/lib/api', () => ({ request: mocks.request }));
vi.mock('@/features/blueprint/components/FileViewer', () => ({
  fileKind: (path: string) => path.endsWith('.pdf') ? 'pdf' : 'text',
}));
vi.mock('@/features/blueprint/lib/blueprint-helpers', () => ({
  isProjectLeanFile: (file: string | null, project = '') =>
    Boolean(file?.endsWith('.lean') && file.startsWith(project)),
  blueprintModeUrl: (base: string, mode: string, search: string, file?: string | null) =>
    `${base}/${mode}${file ? `/${file}` : ''}${search ? `?${search}` : ''}`,
}));
vi.mock('@/features/blueprint/hooks/infoview', () => ({
  useInfoview: () => ({
    state: { setupRequired: true },
    getPendingSaveContent: mocks.getPendingSaveContent,
    reloadFile: mocks.reloadFile,
    saveAndRefresh: mocks.saveAndRefresh,
    updateCursor: mocks.updateCursor,
    hover: mocks.hover,
    flushPendingSave: vi.fn(async () => true),
  }),
}));
vi.mock('@/features/blueprint/hooks/use-repository-directory', () => ({
  useRepositoryDirectory: () => ({
    files: [{ path: 'Project/Main.lean' }, { path: 'README.md' }],
    directories: ['Project'], loading: false, error: null,
  }),
}));
vi.mock('@/lib/lean-setup-events', () => ({
  LEAN_SETUP_READY_EVENT: 'lean-setup-ready',
}));

import { useBlueprintFiles } from '@/features/blueprint/page/use-blueprint-files';

const route = { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.location.pathname = '/workspace/view/Project/Main.lean';
  mocks.location.search = '';
  mocks.fileParam = 'Project/Main.lean';
  mocks.getPendingSaveContent.mockReturnValue(undefined);
  mocks.request.mockResolvedValue({ content: 'theorem demo : True := by trivial' });
});

function mount(isReadonly = false) {
  const onDirty = vi.fn();
  const rendered = renderHook(({ readonly }) => useBlueprintFiles({
    route,
    baseUrl: '/repo/acme/mathlib/blueprint/fermat',
    mode: 'view',
    modeParam: 'view',
    blueprint: { id: 'fermat', project_subdir: 'Project' },
    isReadonly: readonly,
    onDirty,
  }), { initialProps: { readonly: isReadonly } });
  return { ...rendered, onDirty };
}

describe('useBlueprintFiles', () => {
  it('loads the URL-selected file and exposes repository navigation state', async () => {
    const { result } = mount();

    await waitFor(() => expect(result.current.fileContent).toContain('theorem demo'));
    expect(result.current.selectedFile).toBe('Project/Main.lean');
    expect(result.current.selectedFileIsLean).toBe(true);
    expect(result.current.availableFiles).toEqual(['Project/Main.lean', 'README.md']);
    expect(mocks.request).toHaveBeenCalledWith(
      '/repositories/acme/mathlib/files/Project/Main.lean?ref=numina%2Ffermat',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses a pending path-scoped draft without fetching stale bytes', async () => {
    mocks.getPendingSaveContent.mockImplementation((path: string) =>
      path === 'Project/Main.lean' ? 'local draft' : undefined);
    const { result } = mount();

    await waitFor(() => expect(result.current.fileContent).toBe('local draft'));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('lets the visible request finish before accepting a silent refresh', async () => {
    let resolveRequest!: (value: { content: string }) => void;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { result } = mount();

    await waitFor(() => expect(result.current.fileLoading).toBe(true));
    let changed = true;
    await act(async () => {
      changed = await result.current.loadOpenFile({ silent: true });
    });
    expect(changed).toBe(false);
    expect(mocks.request).toHaveBeenCalledOnce();

    await act(async () => resolveRequest({ content: 'loaded once' }));
    await waitFor(() => expect(result.current.fileContent).toBe('loaded once'));
  });

  it('prefers a draft queued while the file request is in flight', async () => {
    let resolveRequest!: (value: { content: string }) => void;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { result } = mount();

    await waitFor(() => expect(result.current.fileLoading).toBe(true));
    mocks.getPendingSaveContent.mockReturnValue('late draft');
    await act(async () => resolveRequest({ content: 'stale server bytes' }));

    await waitFor(() => expect(result.current.fileContent).toBe('late draft'));
    expect(result.current.fileError).toBe(false);
  });

  it('keeps silent failures hidden and exposes visible load failures', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.fileContent).toContain('theorem demo'));

    mocks.request.mockRejectedValueOnce(new Error('silent failure'));
    await act(async () => {
      expect(await result.current.loadOpenFile({ silent: true })).toBe(false);
    });
    expect(result.current.fileContent).toContain('theorem demo');
    expect(result.current.fileError).toBe(false);

    act(() => result.current.handleDiagnosticJump({ line: 3, column: 4 }));
    expect(result.current.pendingJumpTarget).toEqual({
      file: 'Project/Main.lean', line: 3, column: 4,
    });
    mocks.request.mockRejectedValueOnce(new Error('visible failure'));
    await act(async () => {
      expect(await result.current.loadOpenFile()).toBe(false);
    });
    expect(result.current.fileContent).toBe('');
    expect(result.current.fileError).toBe(true);
    expect(result.current.fileLoading).toBe(false);
    expect(result.current.pendingJumpTarget).toBeNull();
  });

  it('saves writable edits, blocks read-only edits, and reacts to Lean setup', async () => {
    const { result, rerender, onDirty } = mount();
    await waitFor(() => expect(result.current.selectedFile).toBe('Project/Main.lean'));

    act(() => result.current.handleContentChange('edited'));
    expect(onDirty).toHaveBeenCalledOnce();
    expect(mocks.saveAndRefresh).toHaveBeenCalledWith('edited');

    rerender({ readonly: true });
    act(() => result.current.handleContentChange('blocked'));
    expect(mocks.saveAndRefresh).not.toHaveBeenCalledWith('blocked');

    act(() => window.dispatchEvent(new CustomEvent('lean-setup-ready', {
      detail: { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' },
    })));
    expect(mocks.reloadFile).toHaveBeenCalled();
  });

  it('navigates file selection and clears the active file for reference previews', () => {
    const { result } = mount();
    act(() => result.current.selectFile('README.md'));
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/repo/acme/mathlib/blueprint/fermat/view/README.md',
    );

    mocks.location.search = '?reference=notes';
    const reference = renderHook(() => useBlueprintFiles({
      route,
      baseUrl: '/repo/acme/mathlib/blueprint/fermat',
      mode: 'view',
      modeParam: 'source',
      blueprint: { id: 'fermat', project_subdir: 'Project' },
      isReadonly: false,
      onDirty: vi.fn(),
    }));
    expect(reference.result.current.showingReference).toBe(true);
    expect(reference.result.current.selectedFile).toBeNull();
  });
});
