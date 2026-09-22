import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchRepositorySources: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/api', () => ({ fetchRepositorySources: mocks.fetchRepositorySources }));
vi.mock('@/features/blueprint/lib/blueprint-helpers', () => ({
  blueprintModeUrl: (base: string, mode: string, search: string) =>
    `${base}/${mode}${search ? `?${search}` : ''}`,
}));

import { useRepositorySources } from '@/features/blueprint/page/use-repository-sources';

const route = { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRepositorySources.mockResolvedValue({
    sources: [
      { id: 'global', display_name: 'Global', metadata: {} },
      { id: 'mine', display_name: 'Mine', metadata: { project_scoped: true, scoped_blueprint_id: 'fermat' } },
      { id: 'other', display_name: 'Other', metadata: { project_scoped: true, scoped_blueprint_id: 'other' } },
    ],
  });
});

function mount(overrides: Record<string, unknown> = {}) {
  const openFile = vi.fn();
  const rendered = renderHook(() => useRepositorySources({
    route,
    baseUrl: '/repo/acme/mathlib/blueprint/fermat',
    repositoryFileSearch: 'chat=1',
    referenceParam: null,
    sourceMounted: true,
    openFile,
    ...overrides,
  }));
  return { ...rendered, openFile };
}

describe('useRepositorySources', () => {
  it('loads sources, filters other projects, and selects the first source', async () => {
    const { result } = mount();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(mocks.fetchRepositorySources).toHaveBeenCalledWith('acme', 'mathlib', 'fermat');
    expect(result.current.visibleSources.map((source) => source.id)).toEqual(['global', 'mine']);
    expect(result.current.selectedSourceId).toBe('global');
  });

  it('deduplicates draft attachments by their context identity', () => {
    const { result } = mount({ sourceMounted: false });
    const attachment = { attachment_kind: 'repo_file', repo_path: 'Project/Main.lean' } as const;

    act(() => {
      result.current.addDraftAttachment(attachment);
      result.current.addDraftAttachment({ ...attachment, display_name: 'Main.lean' });
    });

    expect(result.current.draftAttachments).toHaveLength(1);
  });

  it('opens repository files and backend sources through their canonical routes', async () => {
    const { result, openFile } = mount({ sourceMounted: false });

    act(() => result.current.openContextAttachment({
      attachment_kind: 'repo_file',
      repo_path: 'Project/Main.lean',
      selection: { kind: 'line_range', start_line: 7, end_line: 9 },
    }));
    expect(openFile).toHaveBeenCalledWith('Project/Main.lean', 7);

    await act(async () => result.current.openContextAttachment({
      attachment_kind: 'backend_source', source_id: 'notes',
    }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/repo/acme/mathlib/blueprint/fermat/view?chat=1&reference=notes',
    );
    expect(mocks.fetchRepositorySources).toHaveBeenCalledWith('acme', 'mathlib', 'fermat');
  });

  it('surfaces source loading failures without retaining stale selection', async () => {
    mocks.fetchRepositorySources.mockRejectedValueOnce(new Error('offline'));
    const { result } = mount();

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.loaded).toBe(false);
    expect(result.current.sources).toEqual([]);
    expect(result.current.selectedSourceId).toBe('');
  });
});
