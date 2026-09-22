import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCollaboration } from '@/features/blueprint/hooks/use-collaboration';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCollaboration (desktop stub)', () => {
  it('reports the disconnected state immediately and never opens a socket', () => {
    const socketSpy = vi.fn();
    vi.stubGlobal('WebSocket', class {
      constructor(...args: unknown[]) {
        socketSpy(...args);
      }
    });

    const { result, unmount } = renderHook(() => useCollaboration({
      owner: 'local',
      repo: 'sample',
      blueprintName: 'froda',
      userName: 'Test User',
      runtimeTag: 'a1b2c3d4',
    }));

    expect(result.current.connected).toBe(false);
    expect(result.current.synced).toBe(false);
    expect(result.current.provider).toBeNull();
    expect(result.current.awareness).toBeNull();

    // The web version connected on demand; here connect/disconnect are no-ops
    // and must not flip the flags or reach the network.
    act(() => {
      result.current.connect();
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.synced).toBe(false);
    act(() => {
      result.current.disconnect();
    });
    expect(socketSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('exposes a real local document so the editor contract still type-checks', () => {
    const { result, unmount } = renderHook(() => useCollaboration({
      owner: 'local',
      repo: 'sample',
      blueprintName: 'froda',
    }));
    expect(typeof result.current.doc.guid).toBe('string');
    expect(result.current.text.toString()).toBe('');
    unmount();
  });

  it('swaps in a fresh empty document when the blueprint identity changes', () => {
    const { result, rerender, unmount } = renderHook(
      ({ blueprintName }: { blueprintName: string }) => useCollaboration({
        owner: 'local',
        repo: 'sample',
        blueprintName,
      }),
      { initialProps: { blueprintName: 'froda' } },
    );
    const firstDoc = result.current.doc;
    act(() => {
      result.current.text.insert(0, 'typed');
    });
    rerender({ blueprintName: 'other' });
    expect(result.current.doc).not.toBe(firstDoc);
    expect(result.current.text.toString()).toBe('');
    unmount();
  });

  it('destroy() is idempotent', () => {
    const { result, unmount } = renderHook(() => useCollaboration({
      owner: 'local',
      repo: 'sample',
      blueprintName: 'froda',
    }));
    expect(() => {
      result.current.destroy();
      result.current.destroy();
    }).not.toThrow();
    unmount();
  });
});
