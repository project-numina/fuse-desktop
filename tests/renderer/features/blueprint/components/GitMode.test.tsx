import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commitBlueprintChanges,
  syncBlueprintBranch,
  syncBlueprintFromMain,
  fetchBlueprintBranchStatus,
  fetchBlueprintCommit,
  fetchBlueprintCommits,
  fetchBlueprintDiff,
} from '@/lib/api';

import GitMode from '@/features/blueprint/components/GitMode';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    commitBlueprintChanges: vi.fn(),
    fetchBlueprintBranchStatus: vi.fn(),
    fetchBlueprintCommit: vi.fn(),
    fetchBlueprintCommits: vi.fn(),
    fetchBlueprintDiff: vi.fn(),
    syncBlueprintBranch: vi.fn(),
    syncBlueprintFromMain: vi.fn(),
  };
});

const branchStatusMock = vi.mocked(fetchBlueprintBranchStatus);
const commitMock = vi.mocked(fetchBlueprintCommit);
const commitsMock = vi.mocked(fetchBlueprintCommits);
const diffMock = vi.mocked(fetchBlueprintDiff);

beforeEach(() => {
  branchStatusMock.mockReset().mockResolvedValue({ branch: 'main', has_remote: false });
  commitMock.mockReset();
  commitsMock.mockReset().mockResolvedValue({ commits: [] });
  diffMock.mockReset().mockResolvedValue({ files: [] });
});

describe('GitMode', () => {
  it('describes an empty working tree in local-folder terms', async () => {
    render(
      <GitMode
        blueprint={{ id: 'froda', branch_status: null }}
        context={{ owner: 'local', repo: 'sample', blueprintId: 'froda' }}
      />,
    );

    expect(await screen.findByText('No local changes')).toBeInTheDocument();
    const hint = screen.getByText(/Pending changes in this folder/);
    expect(hint).toHaveTextContent(
      'Edit the blueprint or run an agent. Pending changes in this folder will show up here for review.',
    );
    expect(hint).not.toHaveTextContent(/collaborators/);
  });
  it('keeps changes and history review available without mutation controls', async () => {
    render(
      <GitMode
        blueprint={{ id: 'froda' }}
        context={{ owner: 'local', repo: 'sample', blueprintId: 'froda' }}
      />,
    );
    expect(await screen.findByText('No local changes')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Summary')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Description (optional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /commit|push|sync/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('No commits yet.')).toBeInTheDocument();
    expect(fetchBlueprintCommits).toHaveBeenCalledWith('local', 'sample', 'froda');
    expect(commitBlueprintChanges).not.toHaveBeenCalled();
    expect(syncBlueprintBranch).not.toHaveBeenCalled();
    expect(syncBlueprintFromMain).not.toHaveBeenCalled();
  });

  it('selects a changed file and renders its structured diff', async () => {
    diffMock.mockResolvedValue({
      files: [{
        path: 'Blueprint.lean',
        status: 'modified',
        old_path: null,
        additions: 1,
        deletions: 1,
        diff: '@@ -1 +1 @@\n-theorem old\n+theorem new',
        truncated: false,
        binary: false,
      }],
    });
    render(
      <GitMode
        blueprint={{ id: 'froda' }}
        context={{ owner: 'local', repo: 'sample', blueprintId: 'froda' }}
      />,
    );

    expect(await screen.findByText('theorem old')).toBeInTheDocument();
    expect(screen.getByText('theorem new')).toBeInTheDocument();
    expect(screen.getAllByText('Blueprint.lean')).toHaveLength(2);
  });

  it('drills into a commit and returns to the history list', async () => {
    commitsMock.mockResolvedValue({
      commits: [{
        sha: '1234567890abcdef',
        message: 'Formalize theorem',
        author_name: 'Ada',
        author_login: 'ada',
        author_avatar_url: null,
        authored_at: null,
        html_url: null,
      }],
    });
    commitMock.mockResolvedValue({
      sha: '1234567890abcdef',
      message: 'Formalize theorem',
      author_name: 'Ada',
      author_login: 'ada',
      author_avatar_url: null,
      authored_at: null,
      html_url: null,
      files: [{
        path: 'Main.lean',
        status: 'modified',
        old_path: null,
        additions: 1,
        deletions: 0,
        patch: '@@ -1 +1,2 @@\n theorem base\n+theorem result',
      }],
    });
    render(
      <GitMode
        blueprint={{ id: 'froda' }}
        context={{ owner: 'local', repo: 'sample', blueprintId: 'froda' }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: /Formalize theorem/ }));
    expect(await screen.findByText('theorem result')).toBeInTheDocument();
    expect(screen.getByTitle('1234567890abcdef')).toHaveTextContent('1234567');
    fireEvent.click(screen.getByRole('button', { name: '← History' }));
    expect(await screen.findByRole('button', { name: /Formalize theorem/ }))
      .toBeInTheDocument();
  });
});
