import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request } from '@/lib/api';
import { leanRequestErrorMessage, useInfoview } from '@/features/blueprint/hooks/infoview';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: vi.fn() };
});

describe('useInfoview request coordination', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  it('exposes setup-required failures and clears them after a successful reload', async () => {
    const setupError = new ApiError('Set up Lean to enable live checking.', 409, null, 'lean_setup_required');
    vi.mocked(request).mockRejectedValue(setupError);
    const { result, unmount } = renderHook(() => useInfoview({
      owner: 'local', repo: 'math', blueprintId: 'workspace', filePath: 'A.lean',
    }));
    await waitFor(() => expect(result.current.state.setupRequired).toBe(true));
    let reloaded = true;
    await act(async () => { reloaded = await result.current.reloadFile(); });
    expect(reloaded).toBe(false);
    expect(result.current.state.error).toContain('Set up Lean');
    expect(vi.mocked(request).mock.calls.some(([path]) => String(path).endsWith('/lean/setup'))).toBe(false);

    vi.mocked(request).mockImplementation(async (path) =>
      String(path).endsWith('/lean/diagnostics') ? { items: [], complete: true } : {});
    await act(async () => { reloaded = await result.current.reloadFile(); });
    expect(reloaded).toBe(true);
    expect(result.current.state.setupRequired).toBe(false);
    expect(result.current.state.error).toBeNull();
    unmount();
  });

  it('preserves the backend message for retryable Lean conflicts', () => {
    const error = new ApiError(
      'Lean is still processing this file. Please retry shortly.',
      409,
    );

    expect(leanRequestErrorMessage(error, 'Could not load hover info.')).toBe(
      'Lean is still processing this file. Please retry shortly.',
    );
  });

  it('retries a retryable hover once at the server cadence', async () => {
    vi.useFakeTimers();
    let hoverAttempts = 0;
    vi.mocked(request).mockImplementation(async (path) => {
      if (String(path).endsWith('/lean/hover')) {
        hoverAttempts += 1;
        if (hoverAttempts === 1) {
          throw new ApiError(
            'Lean is still processing this file. Please retry shortly.',
            409,
            null,
            'lean_query_retry',
            0.01,
          );
        }
        return { contents: '`Nat`' };
      }
      if (String(path).includes('/lean/diagnostics')) {
        return { items: [], complete: true };
      }
      return {};
    });
    const { result, unmount } = renderHook(() => useInfoview({
      owner: 'numina',
      repo: 'math',
      blueprintId: 'froda',
      filePath: 'A.lean',
    }));

    const pending = result.current.hover(1, 1, new AbortController().signal);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    await expect(pending).resolves.toMatchObject({ contents: '`Nat`' });
    expect(hoverAttempts).toBe(2);

    unmount();
    vi.useRealTimers();
  });

  it('retains each file draft until that file reaches the clone', async () => {
    let resolveFirstSave!: (value: unknown) => void;
    const firstSave = new Promise((resolve) => {
      resolveFirstSave = resolve;
    });
    let saveCount = 0;
    vi.mocked(request).mockImplementation(async (path) => {
      if (String(path).endsWith('/lean/save')) {
        saveCount += 1;
        if (saveCount === 1) return firstSave;
        return { ok: true };
      }
      if (String(path).includes('/lean/diagnostics')) {
        return { items: [], complete: true };
      }
      return {};
    });

    const { result, rerender, unmount } = renderHook(
      ({ filePath }) => useInfoview({
        owner: 'numina',
        repo: 'math',
        blueprintId: 'froda',
        filePath,
      }),
      { initialProps: { filePath: 'A.lean' as string | null } },
    );

    act(() => result.current.saveAndRefresh('draft A'));
    expect(result.current.getPendingSaveContent('A.lean')).toBe('draft A');

    // Switching files flushes A, but its draft must remain available while the
    // request is in flight. A new B draft is tracked independently.
    rerender({ filePath: 'B.lean' });
    act(() => result.current.saveAndRefresh('draft B'));
    expect(result.current.getPendingSaveContent('A.lean')).toBe('draft A');
    expect(result.current.getPendingSaveContent('B.lean')).toBe('draft B');

    await act(async () => resolveFirstSave({ ok: true }));
    await waitFor(() => {
      expect(result.current.getPendingSaveContent('A.lean')).toBeUndefined();
    });
    expect(result.current.getPendingSaveContent('B.lean')).toBe('draft B');

    unmount();
  });

  it('keeps authoritative squiggles when live diagnostics are provisional', async () => {
    const realError = {
      severity: 'error',
      message: 'type mismatch',
      line: 8,
      column: 3,
    };
    vi.mocked(request).mockImplementation(async (path) => {
      if (String(path).endsWith('/lean/diagnostics/cached')) {
        return { items: [realError], complete: true };
      }
      if (String(path).endsWith('/lean/diagnostics')) {
        return {
          items: [{
            severity: 'error',
            message: 'Imports are out of date and must be rebuilt; use the "Restart File" command.',
            line: 1,
            column: 1,
          }],
          complete: false,
        };
      }
      return {};
    });

    const { result, unmount } = renderHook(() => useInfoview({
      owner: 'numina',
      repo: 'math',
      blueprintId: 'froda',
      filePath: 'A.lean',
    }));

    await waitFor(() => {
      expect(result.current.state.diagnosticsIncomplete).toBe(true);
    });
    expect(result.current.state.diagnostics).toEqual([realError]);
    unmount();
  });

  it('adds failed imports without replacing authoritative squiggles', async () => {
    const realError = {
      severity: 'error',
      message: 'unsolved goals',
      line: 12,
      column: 5,
    };
    vi.mocked(request).mockImplementation(async (path) => {
      if (String(path).endsWith('/lean/diagnostics/cached')) {
        return { items: [realError], complete: true };
      }
      if (String(path).endsWith('/lean/diagnostics')) {
        return {
          items: [],
          complete: false,
          failed_dependencies: ['Mathlib/Broken.lean'],
        };
      }
      return {};
    });

    const { result, unmount } = renderHook(() => useInfoview({
      owner: 'numina',
      repo: 'math',
      blueprintId: 'froda',
      filePath: 'A.lean',
    }));

    await waitFor(() => {
      expect(result.current.state.diagnosticsIncomplete).toBe(true);
    });
    expect(result.current.state.diagnostics.map((item) => item.message)).toEqual([
      'Imported dependencies failed to build: Mathlib/Broken.lean',
      'unsolved goals',
    ]);
    unmount();
  });

  it('drops a hover response after the open file changes', async () => {
    let resolveHover!: (value: unknown) => void;
    const hoverRequest = new Promise((resolve) => {
      resolveHover = resolve;
    });
    const diagnosticsRequest = new Promise<never>(() => {});
    vi.mocked(request).mockImplementation(async (path) => {
      if (String(path).endsWith('/lean/hover')) return hoverRequest;
      if (String(path).includes('/lean/diagnostics')) return diagnosticsRequest;
      return {};
    });

    const { result, rerender, unmount } = renderHook(
      ({ filePath }) => useInfoview({
        owner: 'numina',
        repo: 'math',
        blueprintId: 'froda',
        filePath,
      }),
      { initialProps: { filePath: 'A.lean' as string | null } },
    );

    const pending = result.current.hover(1, 1, new AbortController().signal);
    rerender({ filePath: 'B.lean' });
    let response: unknown;
    await act(async () => {
      resolveHover({
        contents: '`A.value : Nat`',
        start_line: 1,
        start_column: 1,
        end_line: 1,
        end_column: 8,
      });
      response = await pending;
    });

    expect(response).toEqual({
      contents: null,
      start_line: null,
      start_column: null,
      end_line: null,
      end_column: null,
    });
    unmount();
  });
});
