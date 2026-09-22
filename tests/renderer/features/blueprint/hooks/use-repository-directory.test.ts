import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRepositoryDirectory } from '@/lib/api';
import { useRepositoryDirectory } from '@/features/blueprint/hooks/use-repository-directory';

vi.mock('@/lib/api', () => ({ fetchRepositoryDirectory: vi.fn() }));
const fetchDirectory = vi.mocked(fetchRepositoryDirectory);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); fetchDirectory.mockReset(); });
const response = { files: [{ path: 'README.md', name: 'README.md', size: 0 }], directories: ['docs'], truncated: false, clone_ready: true };

describe('automatic directory updates', () => {
  it('updates only the current folder, without a loading flash, and stops when inactive', async () => {
    vi.useFakeTimers();
    fetchDirectory.mockResolvedValue(response);
    const view = renderHook(({ active }) => useRepositoryDirectory('owner', 'repo', 'workspace', '', active), { initialProps: { active: true } });
    await act(async () => {});
    expect(fetchDirectory).toHaveBeenCalledTimes(1);
    expect(fetchDirectory.mock.calls[0].slice(0, 4)).toEqual(['owner', 'repo', 'workspace', '']);
    expect(view.result.current.loading).toBe(false);
    fetchDirectory.mockResolvedValue({ ...response, directories: ['docs', 'new-folder'] });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(view.result.current.directories).toEqual(['docs', 'new-folder']);
    expect(view.result.current.loading).toBe(false);
    view.rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
  });

  it('does not overlap requests and ignores an old folder response after navigation', async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof response) => void;
    fetchDirectory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(({ path }) => useRepositoryDirectory('owner', 'repo', 'workspace', path, true), { initialProps: { path: '' } });
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetchDirectory).toHaveBeenCalledTimes(1);
    const firstSignal = fetchDirectory.mock.calls[0][4]!;
    fetchDirectory.mockResolvedValue({ ...response, files: [], directories: ['docs/proofs'] });
    view.rerender({ path: 'docs' });
    await act(async () => { finish(response); });
    expect(firstSignal.aborted).toBe(true);
    expect(view.result.current.directories).toEqual(['docs/proofs']);
  });

  it('pauses refreshes while hidden and catches up on focus', async () => {
    vi.useFakeTimers();
    fetchDirectory.mockResolvedValue(response);
    renderHook(() => useRepositoryDirectory('owner', 'repo', 'workspace', '', true));
    await act(async () => {});
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetchDirectory).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
  });
});
