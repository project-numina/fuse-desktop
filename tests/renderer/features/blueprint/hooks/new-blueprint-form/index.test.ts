import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspace,
  discoverLakefiles,
  fetchBlueprints,
  fetchRepositoryBranches,
} from '@/lib/api';
import { useNewBlueprintForm } from '@/features/blueprint/hooks/new-blueprint-form';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    createWorkspace: vi.fn(),
    discoverLakefiles: vi.fn(),
    fetchBlueprints: vi.fn(),
    fetchRepositoryBranches: vi.fn(),
  };
});

const createWorkspaceMock = vi.mocked(createWorkspace);
const discoverLakefilesMock = vi.mocked(discoverLakefiles);
const fetchBlueprintsMock = vi.mocked(fetchBlueprints);
const fetchBranchesMock = vi.mocked(fetchRepositoryBranches);

const rootLakefile = { directory: '', lakefile: 'lakefile.toml', path: 'lakefile.toml' };
const nestedLakefile = {
  directory: 'Math/Algebra',
  lakefile: 'lakefile.lean',
  path: 'Math/Algebra/lakefile.lean',
};

beforeEach(() => {
  navigate.mockReset();
  createWorkspaceMock.mockReset().mockResolvedValue({ blueprint_id: 'new-proof' });
  fetchBlueprintsMock.mockReset().mockResolvedValue([]);
  fetchBranchesMock.mockReset().mockResolvedValue({
    branches: ['develop', '', 'feature', 'develop'],
    default_branch: 'develop',
  });
  discoverLakefilesMock.mockReset().mockResolvedValue({
    lakefiles: [nestedLakefile, rootLakefile],
    truncated: false,
  });
});

function renderForm(initialTitle = 'My proof', initialBaseBranch = '') {
  return renderHook(() => useNewBlueprintForm({
    owner: 'numina',
    repo: 'math',
    initialTitle,
    initialBaseBranch,
  }));
}

async function waitForBootstrap(result: ReturnType<typeof renderForm>['result']) {
  await waitFor(() => expect(result.current.isLoadingBranches).toBe(false));
  await waitFor(() => expect(result.current.isLoadingLakefiles).toBe(false));
}

describe('useNewBlueprintForm', () => {
  it('bootstraps unique branches, honors a valid initial branch, and derives lakefile state', async () => {
    const { result } = renderForm('Initial', 'feature');
    await waitForBootstrap(result);

    expect(result.current.repositoryBranches).toEqual(['develop', 'feature']);
    expect(result.current.baseBranch).toBe('feature');
    expect(discoverLakefilesMock).toHaveBeenCalledWith('numina', 'math', 'feature');
    expect(result.current.lakefiles).toEqual([rootLakefile, nestedLakefile]);
    expect(result.current.selectedLakefile).toEqual(rootLakefile);
    expect(result.current.shouldShowLakefileSelector).toBe(true);

    act(() => result.current.setBranchSearchQuery('FEA'));
    act(() => result.current.setLakefileSearchQuery('algebra'));
    expect(result.current.filteredBranches).toEqual(['feature']);
    expect(result.current.filteredLakefiles).toEqual([nestedLakefile]);
  });

  it('drops a stale lakefile response after the base branch changes', async () => {
    let resolveDevelop!: (value: { lakefiles: typeof rootLakefile[]; truncated: boolean }) => void;
    const developRequest = new Promise<{ lakefiles: typeof rootLakefile[]; truncated: boolean }>(
      resolve => { resolveDevelop = resolve; },
    );
    discoverLakefilesMock.mockImplementation((_owner, _repo, branch) => {
      if (branch === 'develop') return developRequest;
      return Promise.resolve({ lakefiles: [nestedLakefile], truncated: true });
    });

    const { result } = renderForm();
    await waitFor(() => expect(discoverLakefilesMock).toHaveBeenCalledWith('numina', 'math', 'develop'));

    act(() => result.current.selectBaseBranch('feature'));
    await waitFor(() => expect(result.current.selectedLakefileDir).toBe('Math/Algebra'));
    expect(result.current.lakefilesTruncated).toBe(true);

    await act(async () => resolveDevelop({ lakefiles: [rootLakefile], truncated: false }));
    expect(result.current.baseBranch).toBe('feature');
    expect(result.current.lakefiles).toEqual([nestedLakefile]);
    expect(result.current.selectedLakefileDir).toBe('Math/Algebra');
  });

  it('validates required and duplicate titles before creating', async () => {
    fetchBlueprintsMock.mockResolvedValue([{ id: 'existing-proof' }]);
    const { result } = renderForm('Existing proof');
    await waitForBootstrap(result);

    await act(async () => result.current.handleCreate());
    expect(result.current.errorMessage).toBe('A blueprint with this title already exists');
    expect(createWorkspaceMock).not.toHaveBeenCalled();

    act(() => result.current.setBlueprintTitle('   '));
    await act(async () => result.current.handleCreate());
    expect(result.current.errorMessage).toBe('Please enter a title');
  });

  it('blocks creation while branches are loading and when no branch can be selected', async () => {
    let resolveBranches!: (value: { branches: string[]; default_branch: string }) => void;
    fetchBranchesMock.mockImplementation(() => new Promise(resolve => {
      resolveBranches = resolve;
    }));
    const { result } = renderForm('Waiting');
    await waitFor(() => expect(fetchBranchesMock).toHaveBeenCalled());

    await act(async () => result.current.handleCreate());
    expect(result.current.errorMessage).toBe('Loading branches, please wait…');
    expect(createWorkspaceMock).not.toHaveBeenCalled();

    await act(async () => resolveBranches({ branches: [], default_branch: '' }));
    await waitForBootstrap(result);
    await act(async () => result.current.handleCreate());
    expect(result.current.errorMessage).toBe('Please select a base branch');
  });

  it('routes to scaffold when discovery finds no Lean project', async () => {
    discoverLakefilesMock.mockResolvedValue({ lakefiles: [], truncated: false });
    const { result } = renderForm('Lean setup');
    await waitForBootstrap(result);
    expect(result.current.noLakefileFound).toBe(true);

    await act(async () => result.current.handleCreate());

    expect(createWorkspaceMock).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/new?owner=numina&repo=math&base=develop&title=Lean+setup');
  });

  it('submits the selected branch and project, then navigates to edit mode', async () => {
    const { result } = renderForm('New theorem');
    await waitForBootstrap(result);
    act(() => result.current.selectLakefile(nestedLakefile));

    await act(async () => result.current.handleCreate());

    expect(createWorkspaceMock).toHaveBeenCalledOnce();
    const [, , formData] = createWorkspaceMock.mock.calls[0];
    expect(Object.fromEntries(formData.entries())).toEqual({
      title: 'New theorem',
      base_branch: 'develop',
      project_subdir: 'Math/Algebra',
    });
    expect(navigate).toHaveBeenCalledWith(
      '/repo/numina/math/blueprint/new-proof/blueprint',
    );
    expect(result.current.isSubmitting).toBe(false);
  });

  it('falls back to the backend default after branch loading fails and surfaces create errors', async () => {
    fetchBranchesMock.mockRejectedValue(new Error('offline'));
    discoverLakefilesMock.mockResolvedValue({ lakefiles: [rootLakefile], truncated: false });
    createWorkspaceMock.mockRejectedValue(new Error('boom'));
    const { result } = renderForm('Fallback');
    await waitForBootstrap(result);

    expect(result.current.branchesLoadFailed).toBe(true);
    expect(discoverLakefilesMock).toHaveBeenCalledWith('numina', 'math', undefined);
    await act(async () => result.current.handleCreate());

    const [, , formData] = createWorkspaceMock.mock.calls[0];
    expect(formData.has('base_branch')).toBe(false);
    expect(result.current.errorMessage).toBe('Could not create blueprint. Please try again.');

    act(() => result.current.goBack());
    expect(navigate).toHaveBeenLastCalledWith('/repo/numina/math');
  });
});
