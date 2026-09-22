import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  load: vi.fn(),
  params: new URLSearchParams(),
  repositories: [{
    id: 1,
    owner: 'home',
    name: 'lean-project',
    visibility: 'private',
  }],
  fetchLean4Tags: vi.fn(),
  setupRepository: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.params],
}));
vi.mock('@/state/dashboard', () => ({
  useDashboard: () => ({
    state: { repositories: mocks.repositories },
    load: mocks.load,
  }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  fetchLean4Tags: mocks.fetchLean4Tags,
  setupRepository: mocks.setupRepository,
}));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: vi.fn() }));
vi.mock('@/desktop/bridge', () => ({
  isDesktop: () => true,
  pickAndRegisterFolder: vi.fn(),
}));

import { useNewProjectWorkflow } from '@/pages/new-project/use-new-project-workflow';

describe('useNewProjectWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.params = new URLSearchParams();
    mocks.load.mockResolvedValue(undefined);
    mocks.fetchLean4Tags.mockResolvedValue([{ name: 'v4.25.0' }]);
    mocks.setupRepository.mockResolvedValue(undefined);
  });

  it('bootstraps repositories and seeds the module before advancing', async () => {
    const { result } = renderHook(() => useNewProjectWorkflow());

    await waitFor(() => expect(result.current.selectedRepoId).toBe(1));
    await waitFor(() => expect(result.current.moduleName).toBe('LeanProject'));
    expect(mocks.load).toHaveBeenCalledWith({ force: false });

    act(() => result.current.nextStep());
    expect(result.current.step).toBe(2);
    await waitFor(() => expect(mocks.fetchLean4Tags).toHaveBeenCalledOnce());
  });

  it('validates the module name before sending a setup request', async () => {
    const { result } = renderHook(() => useNewProjectWorkflow());
    await waitFor(() => expect(result.current.moduleName).toBe('LeanProject'));

    act(() => result.current.onModuleNameInput({
      target: { value: 'lowercase-name' },
    } as never));
    await act(async () => result.current.handleCreate());

    expect(mocks.setupRepository).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe(
      'Module name must start with a capital letter and contain only letters, digits, and underscores.',
    );
    expect(result.current.isSubmitting).toBe(false);
  });

  it('preserves setup payload and waits for refresh before normal navigation', async () => {
    const { result } = renderHook(() => useNewProjectWorkflow());
    await waitFor(() => expect(result.current.moduleName).toBe('LeanProject'));
    act(() => {
      result.current.onModuleNameInput({ target: { value: 'CustomModule' } } as never);
      result.current.setSelectedLeanVersionId('v4.25.0');
      result.current.setTargetSubdir(' /formalization/ ');
    });
    mocks.load.mockClear();
    mocks.navigate.mockClear();

    let releaseSetup = () => {};
    mocks.setupRepository.mockReturnValueOnce(new Promise<void>((resolve) => {
      releaseSetup = resolve;
    }));
    let creation: Promise<void> | undefined;
    act(() => {
      creation = result.current.handleCreate();
    });

    expect(mocks.setupRepository).toHaveBeenCalledWith(
      'home',
      'lean-project',
      'CustomModule',
      'v4.25.0',
      'formalization',
    );
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    releaseSetup();
    await act(async () => creation);

    expect(mocks.load).toHaveBeenCalledWith({ force: true });
    expect(mocks.navigate).toHaveBeenCalledWith('/repo/home/lean-project');
    expect(mocks.setupRepository.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.load.mock.invocationCallOrder[0]);
    expect(mocks.load.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.navigate.mock.invocationCallOrder[0]);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('routes direct setup to blueprint creation without refreshing repositories', async () => {
    mocks.params = new URLSearchParams({
      owner: 'home',
      repo: 'lean-project',
      title: 'Main result',
      base: 'develop',
    });
    const { result } = renderHook(() => useNewProjectWorkflow());

    await waitFor(() => expect(result.current.selectedRepoId).toBe(1));
    await waitFor(() => expect(result.current.moduleName).toBe('LeanProject'));
    await waitFor(() => expect(mocks.fetchLean4Tags).toHaveBeenCalledOnce());
    expect(result.current.step).toBe(2);
    mocks.load.mockClear();
    mocks.navigate.mockClear();

    await act(async () => result.current.handleCreate());

    expect(mocks.setupRepository).toHaveBeenCalledWith(
      'home',
      'lean-project',
      'LeanProject',
      undefined,
      undefined,
    );
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/repo/home/lean-project/blueprint/new?title=Main+result&base=develop',
    );
  });
});
