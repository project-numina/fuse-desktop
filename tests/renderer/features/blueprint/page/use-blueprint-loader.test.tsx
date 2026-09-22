import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  store: {
    state: { blueprint: null as Record<string, unknown> | null, error: null as string | null },
    load: vi.fn(async () => undefined),
  },
  setDocumentTitle: vi.fn(),
  setWorkspaceRuntimeTag: vi.fn(),
}));

vi.mock('@/features/blueprint/state/blueprint-page', () => ({
  useBlueprintPage: () => mocks.store,
}));
vi.mock('@/features/blueprint/lib/blueprint-helpers', () => ({
  formatBlueprintLabel: (id: string) => `Blueprint ${id}`,
}));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: mocks.setDocumentTitle }));
vi.mock('@/lib/inline-math-text', () => ({
  stripInlineMathDelimiters: (value: string) => value.replaceAll('\\(', '').replaceAll('\\)', ''),
}));
vi.mock('@/lib/runtime-routing', () => ({
  runtimeRouteTag: (sessionId: string | null) => sessionId ? `session:${sessionId}` : null,
  setWorkspaceRuntimeTag: mocks.setWorkspaceRuntimeTag,
}));

import { useBlueprintLoader } from '@/features/blueprint/page/use-blueprint-loader';

const route = { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.state = { blueprint: null, error: null };
});

describe('useBlueprintLoader', () => {
  it('loads a missing route and manages its runtime identity', () => {
    const { result, unmount } = renderHook(() => useBlueprintLoader(route, 'run-1'));

    expect(result.current.loading).toBe(true);
    expect(mocks.store.load).toHaveBeenCalledWith('acme', 'mathlib', 'fermat');
    expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Blueprint fermat');
    expect(mocks.setWorkspaceRuntimeTag).toHaveBeenCalledWith(
      'acme', 'mathlib', 'fermat', 'session:run-1',
    );

    unmount();
    expect(mocks.setWorkspaceRuntimeTag).toHaveBeenLastCalledWith(
      'acme', 'mathlib', 'fermat', null,
    );
  });

  it('adopts a matching prefetched blueprint without loading it again', () => {
    mocks.store.state = {
      blueprint: { id: 'fermat', name: '\\(Fermat\\)', can_edit: false, runtime_route_tag: 'release' },
      error: null,
    };
    const { result } = renderHook(() => useBlueprintLoader(route, null));

    expect(result.current.blueprint?.id).toBe('fermat');
    expect(result.current.loading).toBe(false);
    expect(result.current.canEdit).toBe(false);
    expect(mocks.store.load).not.toHaveBeenCalled();
    expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Fermat');
    expect(mocks.setWorkspaceRuntimeTag).toHaveBeenCalledWith(
      'acme', 'mathlib', 'fermat', 'release',
    );
  });

  it('reacts to a store error after an attempted load', () => {
    const { result, rerender } = renderHook(() => useBlueprintLoader(route, null));
    mocks.store.state = { blueprint: null, error: 'Workspace missing' };

    act(() => rerender());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Workspace missing');
  });
});
