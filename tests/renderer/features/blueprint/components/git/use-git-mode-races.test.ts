import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchBlueprintBranchStatus,
  fetchBlueprintCommit,
  fetchBlueprintCommits,
  fetchBlueprintDiff,
  type BlueprintCommitDetail,
  type BlueprintDiffFile,
} from '@/lib/api';
import { useGitMode } from '@/features/blueprint/components/git/use-git-mode';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    fetchBlueprintBranchStatus: vi.fn(),
    fetchBlueprintCommit: vi.fn(),
    fetchBlueprintCommits: vi.fn(),
    fetchBlueprintDiff: vi.fn(),
  };
});

const branchStatusMock = vi.mocked(fetchBlueprintBranchStatus);
const commitMock = vi.mocked(fetchBlueprintCommit);
const commitsMock = vi.mocked(fetchBlueprintCommits);
const diffMock = vi.mocked(fetchBlueprintDiff);
const context = { owner: 'local', repo: 'sample', blueprintId: 'froda' };

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
}

function detail(sha: string, paths: string[]): BlueprintCommitDetail {
  return {
    sha,
    message: `${sha} subject\n\nBody`,
    author_name: 'Author',
    author_login: 'author',
    author_avatar_url: null,
    authored_at: '2026-01-01T00:00:00Z',
    html_url: null,
    files: paths.map((path) => ({
      path,
      status: 'modified',
      old_path: null,
      additions: 1,
      deletions: 0,
      patch: '@@ -1 +1 @@\n-old\n+new',
    })),
  };
}

function diffFile(path: string): BlueprintDiffFile {
  return {
    path,
    status: 'modified',
    old_path: null,
    additions: 1,
    deletions: 0,
    diff: '@@ -1 +1 @@\n-old\n+new',
    truncated: false,
    binary: false,
  };
}

beforeEach(() => {
  branchStatusMock.mockReset().mockResolvedValue({ branch: 'main', has_remote: false });
  commitMock.mockReset();
  commitsMock.mockReset().mockResolvedValue({ commits: [] });
  diffMock.mockReset().mockResolvedValue({ files: [] });
});

describe('useGitMode request races', () => {
  it('keeps the newest commit when detail responses resolve out of order', async () => {
    const oldRequest = deferred<BlueprintCommitDetail>();
    const newRequest = deferred<BlueprintCommitDetail>();
    commitMock.mockImplementation((_owner, _repo, _blueprint, sha) => (
      sha === 'old' ? oldRequest.promise : newRequest.promise
    ));
    const { result } = renderHook(() => useGitMode({ blueprint: { id: 'froda' }, context, active: true }));
    act(() => result.current.setActiveTab('history'));

    let oldSelection!: Promise<void>;
    let newSelection!: Promise<void>;
    act(() => {
      oldSelection = result.current.selectCommit('old');
      newSelection = result.current.selectCommit('new');
    });
    await act(async () => {
      newRequest.resolve(detail('new', ['numina/.metadata/data.json', 'chapter.tex']));
      await newSelection;
      oldRequest.resolve(detail('old', ['old.tex']));
      await oldSelection;
    });

    expect(result.current.selectedCommitSha).toBe('new');
    expect(result.current.commitDetail?.sha).toBe('new');
    expect(result.current.selectedCommitFilePath).toBe('chapter.tex');
    expect(result.current.historyView).toBe('detail');
  });

  it('invalidates an in-flight detail request when returning to the list', async () => {
    const request = deferred<BlueprintCommitDetail>();
    commitMock.mockReturnValue(request.promise);
    const { result } = renderHook(() => useGitMode({ blueprint: { id: 'froda' }, context, active: true }));
    act(() => result.current.setActiveTab('history'));
    let selection!: Promise<void>;
    act(() => { selection = result.current.selectCommit('pending'); });
    act(() => result.current.backToHistoryList());
    await act(async () => {
      request.resolve(detail('pending', ['chapter.tex']));
      await selection;
    });

    expect(result.current.historyView).toBe('list');
    expect(result.current.selectedCommitSha).toBeNull();
    expect(result.current.commitDetail).toBeNull();
    expect(result.current.commitDetailLoading).toBe(false);
  });

  it('does not drill into history after the user switches tabs', async () => {
    const request = deferred<BlueprintCommitDetail>();
    commitMock.mockReturnValue(request.promise);
    const { result } = renderHook(() => useGitMode({ blueprint: { id: 'froda' }, context, active: true }));
    act(() => result.current.setActiveTab('history'));
    let selection!: Promise<void>;
    act(() => { selection = result.current.selectCommit('pending'); });
    act(() => result.current.setActiveTab('changes'));
    await act(async () => {
      request.resolve(detail('pending', ['chapter.tex']));
      await selection;
    });

    expect(result.current.commitDetail?.sha).toBe('pending');
    expect(result.current.historyView).toBe('list');
  });
});

describe('useGitMode diff selection', () => {
  it('hides metadata and retains a still-visible selection across refreshes', async () => {
    diffMock.mockResolvedValueOnce({
      files: [diffFile('.metadata/generated.json'), diffFile('a.tex'), diffFile('b.tex')],
    }).mockResolvedValueOnce({ files: [diffFile('b.tex'), diffFile('c.tex')] });
    const { result, rerender } = renderHook(
      ({ dirty }) => useGitMode({ blueprint: { id: 'froda' }, context, active: true, hasUncommittedChanges: dirty }),
      { initialProps: { dirty: false } },
    );
    await waitFor(() => expect(result.current.selectedDiffPath).toBe('a.tex'));
    expect(result.current.hiddenMetadataDiffCount).toBe(1);
    act(() => result.current.setSelectedDiffPath('b.tex'));
    rerender({ dirty: true });
    await waitFor(() => expect(diffMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.visibleDiffFiles.map((file) => file.path)).toEqual(['b.tex', 'c.tex']));
    expect(result.current.selectedDiffPath).toBe('b.tex');
  });
});
