import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  fetchBlueprintBranchStatus,
  fetchBlueprintCommits,
  fetchBlueprintDiff,
} from '@/lib/api';

import { useGitMode, type GitBlueprint } from '@/features/blueprint/components/git/use-git-mode';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    fetchBlueprintBranchStatus: vi.fn(),
    fetchBlueprintCommit: vi.fn(),
    fetchBlueprintCommits: vi.fn(),
    fetchBlueprintDiff: vi.fn(),
    syncBlueprintBranch: vi.fn(),
    syncBlueprintFromMain: vi.fn(),
  };
});

const branchStatusMock = vi.mocked(fetchBlueprintBranchStatus);
const commitsMock = vi.mocked(fetchBlueprintCommits);
const diffMock = vi.mocked(fetchBlueprintDiff);

const context = { owner: 'local', repo: 'sample', blueprintId: 'froda' };

function renderGitMode(blueprint: GitBlueprint, active = true) {
  return renderHook(() => useGitMode({
    blueprint,
    context,
    active,
  }));
}

beforeEach(() => {
  branchStatusMock.mockReset();
  commitsMock.mockReset().mockResolvedValue({ commits: [] });
  diffMock.mockReset().mockResolvedValue({ files: [] });
});

describe('useGitMode branch identity', () => {
  it('shows the checked-out branch from the blueprint payload', async () => {
    branchStatusMock.mockResolvedValue({ branch: 'feature/x', has_remote: true });
    const { result } = renderGitMode({
      id: 'froda',
      branch_status: {
        branch: 'main', is_dirty: false, commits_ahead: 0, commits_behind: 0,
        is_diverged: false, needs_reconcile: false,
      },
    });
    expect(result.current.branchName).toBe('main');
    // The payload wins over the live probe; it is what the rest of the page shows.
    await waitFor(() => expect(branchStatusMock).toHaveBeenCalledWith('local', 'sample', 'froda'));
    expect(result.current.branchName).toBe('main');
  });

  it('falls back to the live branch-status probe, then to HEAD', async () => {
    let resolveProbe!: (value: { branch: string | null; has_remote: boolean }) => void;
    branchStatusMock.mockImplementation(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    const { result } = renderGitMode({ id: 'froda', branch_status: null });
    expect(result.current.branchName).toBe('HEAD');
    await waitFor(() => expect(branchStatusMock).toHaveBeenCalled());
    await act(async () => resolveProbe({ branch: 'work', has_remote: false }));
    expect(result.current.branchName).toBe('work');
  });

  it('never derives a numina/<id> branch name', async () => {
    branchStatusMock.mockRejectedValue(new ApiError('not found', 404));
    const { result } = renderGitMode({ id: 'froda', branch_status: null });
    await waitFor(() => expect(branchStatusMock).toHaveBeenCalled());
    expect(result.current.branchName).not.toContain('numina/');
  });
});

describe('useGitMode read-only review', () => {
  it('exposes no commit or sync handlers, even when a remote exists', async () => {
    branchStatusMock.mockResolvedValue({ branch: 'main', has_remote: true });
    const { result } = renderGitMode({ id: 'froda', branch_status: null });
    await waitFor(() => expect(result.current.branchName).toBe('main'));
    expect(result.current).not.toHaveProperty('submitCommit');
    expect(result.current).not.toHaveProperty('syncFromRemote');
    expect(result.current).not.toHaveProperty('syncFromMain');
    await act(async () => result.current.setActiveTab('history'));
    await waitFor(() => expect(commitsMock).toHaveBeenCalledWith('local', 'sample', 'froda'));
  });

  it('does not load data while the view is inactive', () => {
    renderGitMode({ id: 'froda' }, false);
    expect(diffMock).not.toHaveBeenCalled();
    expect(commitsMock).not.toHaveBeenCalled();
    expect(branchStatusMock).not.toHaveBeenCalled();
  });

  it('refreshes diffs when local edits change', async () => {
    const { rerender } = renderHook(
      ({ dirty }) => useGitMode({ blueprint: { id: 'froda' }, context, active: true, hasUncommittedChanges: dirty }),
      { initialProps: { dirty: false } },
    );
    await waitFor(() => expect(diffMock).toHaveBeenCalledTimes(1));
    rerender({ dirty: true });
    await waitFor(() => expect(diffMock).toHaveBeenCalledTimes(2));
  });
});
