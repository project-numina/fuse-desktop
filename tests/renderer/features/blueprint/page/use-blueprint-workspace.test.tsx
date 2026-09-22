import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setLeanDirty: vi.fn(),
  loaderHook: vi.fn(),
  modeHook: vi.fn(),
  editingHook: vi.fn(),
  filesHook: vi.fn(),
  sourcesHook: vi.fn(),
  refreshHook: vi.fn(),
  chatRoutingHook: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('@/state/chat', () => ({
  useChat: () => ({ state: { sessionId: 'run-1' } }),
}));
vi.mock('@/features/blueprint/page/use-blueprint-loader', () => ({
  useBlueprintLoader: (...args: unknown[]) => {
    mocks.loaderHook(...args);
    return {
      blueprint: { id: 'fermat' }, blueprintRef: { current: { id: 'fermat' } },
      setBlueprint: vi.fn(), canEdit: true,
    };
  },
}));
vi.mock('@/features/blueprint/page/use-blueprint-mode-routing', () => ({
  useBlueprintModeRouting: (...args: unknown[]) => {
    mocks.modeHook(...args);
    return {
      baseUrl: '/workspace', mode: 'home', modeParam: 'home',
      mountedModes: new Set(['home']),
    };
  },
}));
vi.mock('@/features/blueprint/page/use-blueprint-editing', () => ({
  useBlueprintEditing: (...args: unknown[]) => {
    mocks.editingHook(...args);
    return { setLeanDirty: mocks.setLeanDirty };
  },
}));
vi.mock('@/features/blueprint/page/use-blueprint-files', () => ({
  useBlueprintFiles: (...args: unknown[]) => {
    mocks.filesHook(...args);
    return { repositoryFileSearch: '', referenceParam: null, openFile: vi.fn() };
  },
}));
vi.mock('@/features/blueprint/page/use-repository-sources', () => ({
  useRepositorySources: (...args: unknown[]) => {
    mocks.sourcesHook(...args);
    return { source: true };
  },
}));
vi.mock('@/features/blueprint/page/use-blueprint-refresh', () => ({
  useBlueprintRefresh: (...args: unknown[]) => {
    mocks.refreshHook(...args);
    return { refresh: true };
  },
}));
vi.mock('@/features/blueprint/page/use-blueprint-chat-routing', () => ({
  useBlueprintChatRouting: (...args: unknown[]) => {
    mocks.chatRoutingHook(...args);
    return { chatRouting: true };
  },
}));

import { useBlueprintWorkspace } from '@/features/blueprint/page/use-blueprint-workspace';

it('composes workspace hooks and connects file edits to Lean dirtiness', () => {
  const route = { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' };
  const { result } = renderHook(() => useBlueprintWorkspace(route));

  expect(mocks.loaderHook).toHaveBeenCalledWith(route, 'run-1');
  expect(mocks.refreshHook).toHaveBeenCalled();
  const fileOptions = mocks.filesHook.mock.calls[0][0] as { onDirty: () => void };
  act(() => fileOptions.onDirty());
  expect(mocks.setLeanDirty).toHaveBeenCalledWith(true);
  expect(result.current.route).toBe(route);
  expect(result.current.sources).toEqual({ source: true });
});
