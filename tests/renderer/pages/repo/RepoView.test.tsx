import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import RepoView from '@/pages/repo/RepoView';
import type { RepoPageModel } from '@/pages/repo/use-repo-page';

function model(overrides: Partial<RepoPageModel> = {}): RepoPageModel {
  const blueprint = { id: 'bp-1', name: 'First theorem', can_edit: true };
  return {
    blueprints: [blueprint],
    canRevealRepository: false,
    completedPullRequests: [],
    createBlueprint: vi.fn(),
    deleteError: null,
    error: null,
    findBlueprintPullRequest: vi.fn(() => null),
    findPullRequestBlueprint: vi.fn(() => null),
    openPullRequestBlueprint: vi.fn(),
    pathForBlueprint: vi.fn(() => '/repo/numina/fuse/blueprint/bp-1'),
    pendingDeletes: new Set(),
    pullRequestStatusLabel: vi.fn((status: string) => status),
    repository: {
      name: 'Fuse',
      owner: 'numina',
      description: 'Formalization',
      path: null,
    },
    requestDelete: vi.fn(),
    revealRepository: vi.fn(),
    undoDelete: vi.fn(),
    ...overrides,
  };
}

describe('RepoView', () => {
  it('renders repository actions and delegates workspace deletion', () => {
    const values = model();
    render(<MemoryRouter><RepoView model={values} /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'First theorem' }))
      .toHaveAttribute('href', '/repo/numina/fuse/blueprint/bp-1');
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    fireEvent.click(screen.getByTitle('Delete blueprint'));
    expect(values.createBlueprint).toHaveBeenCalledOnce();
    expect(values.requestDelete).toHaveBeenCalledWith('bp-1');
  });

  it('keeps deferred-delete errors visible beside a load error', () => {
    render(
      <MemoryRouter>
        <RepoView model={model({ error: 'Load failed', deleteError: 'Delete failed' })} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Load failed')).toBeInTheDocument();
    expect(screen.getByText('Delete failed')).toBeInTheDocument();
  });
});
