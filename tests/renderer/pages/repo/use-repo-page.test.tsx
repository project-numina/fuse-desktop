import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flushCurrent: vi.fn(),
  load: vi.fn(),
  navigate: vi.fn(),
  reveal: vi.fn(),
  state: {
    repository: {
      name: 'Fuse',
      owner: 'numina',
      description: null,
      path: '/projects/fuse',
    },
    blueprints: [
      { id: 'active', name: 'Active' },
      { id: 'merged', name: 'Merged' },
    ],
    pullRequests: [
      { number: 1, title: 'Done', branch: 'numina/merged', status: 'merged' },
    ],
    error: null,
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ owner: 'numina', repo: 'fuse' }),
}));
vi.mock('@/state/repository-page', () => ({
  useRepositoryPage: () => ({ state: mocks.state, load: mocks.load }),
}));
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ pullRequestStatusLabel: (status: string) => status }),
}));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: vi.fn() }));
vi.mock('@/desktop/bridge', () => ({
  isDesktop: () => true,
  showInFolder: mocks.reveal,
}));
vi.mock('@/pages/repo/use-pending-blueprint-deletes', () => ({
  usePendingBlueprintDeletes: () => ({
    deleteError: null,
    flushCurrent: mocks.flushCurrent,
    pendingDeletes: new Set(),
    recoveringDeletes: new Set(),
    requestDelete: vi.fn(),
    undoDelete: vi.fn(),
  }),
}));

import { useRepoPage } from '@/pages/repo/use-repo-page';

describe('useRepoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(undefined);
  });

  it('loads route data and derives active/completed navigation', () => {
    const { result, unmount } = renderHook(() => useRepoPage());

    expect(mocks.load).toHaveBeenCalledWith('numina', 'fuse');
    expect(result.current.blueprints.map((item) => item.id)).toEqual(['active']);
    expect(result.current.completedPullRequests).toHaveLength(1);
    act(() => result.current.createBlueprint());
    expect(mocks.navigate).toHaveBeenCalledWith('/repo/numina/fuse/blueprint/new');
    act(() => result.current.revealRepository());
    expect(mocks.reveal).toHaveBeenCalledWith('/projects/fuse');

    unmount();
    expect(mocks.flushCurrent).toHaveBeenCalledOnce();
  });
});
