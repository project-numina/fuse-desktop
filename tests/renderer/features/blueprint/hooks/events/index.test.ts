import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BranchFreshness } from '@/lib/api';

import { useBlueprintEvents } from '@/features/blueprint/hooks/events';

const chatOn = vi.fn();
const chatOff = vi.fn();
const chatState: { sessionId: string | null } = { sessionId: null };

vi.mock('@/state/chat', () => ({
  useChat: () => ({ state: chatState, on: chatOn, off: chatOff }),
}));

class MockEventSource {
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: Event) => void>>();
  readonly registeredTypes: string[] = [];
  readyState = 1;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;

  constructor(url: string, _options?: EventSourceInit) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.registeredTypes.push(type);
    const callback = typeof listener === 'function'
      ? listener
      : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  emit(type: string, payload: object) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  chatOn.mockReset();
  chatOff.mockReset();
  chatState.sessionId = null;
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBlueprintEvents', () => {
  it('pins the stream to the configured workspace release', () => {
    const { unmount } = renderHook(() => useBlueprintEvents({
      owner: 'numina',
      repo: 'math',
      blueprintId: 'froda',
      runtimeTag: 'a1b2c3d4',
      callbacks: {
        collaboration: { connected: false, synced: false },
        blueprint: null,
        isViewMounted: () => false,
        hasPendingLocalSave: () => false,
        deferRefreshUntilSaved: vi.fn(),
        refreshBlueprintContent: vi.fn().mockResolvedValue(undefined),
        syncLatexSourceFromActiveChapter: vi.fn(),
        markBlueprintSynced: vi.fn(),
        reloadOpenFile: vi.fn(),
      },
    }));

    expect(MockEventSource.instances[0].url).toBe(
      '/api/repositories/numina/math/blueprints/froda/events?runtime=a1b2c3d4',
    );
    expect(MockEventSource.instances[0].registeredTypes).toEqual([
      'blueprint_edit',
      'build_snapshot',
      'build_errors_snapshot',
      'build_errors_updated',
      'build_status',
      'ocr_snapshot',
      'ocr_status',
      'buffer_overflow',
      'blueprint_sync',
      'blueprint_rebase',
      'blueprint_branch_status',
      'blueprint_branch_freshness',
    ]);
    unmount();
  });

  it('does not tear down the stream when runtime affinity becomes known', () => {
    const callbacks = {
      collaboration: { connected: false, synced: false },
      blueprint: null,
      isViewMounted: () => false,
      hasPendingLocalSave: () => false,
      deferRefreshUntilSaved: vi.fn(),
      refreshBlueprintContent: vi.fn().mockResolvedValue(undefined),
      syncLatexSourceFromActiveChapter: vi.fn(),
      markBlueprintSynced: vi.fn(),
      reloadOpenFile: vi.fn(),
    };
    const { rerender, unmount } = renderHook(
      ({ runtimeTag }: { runtimeTag: string | null }) => useBlueprintEvents({
        owner: 'numina',
        repo: 'math',
        blueprintId: 'froda',
        runtimeTag,
        callbacks,
      }),
      { initialProps: { runtimeTag: null as string | null } },
    );

    rerender({ runtimeTag: 'a1b2c3d4' });

    expect(MockEventSource.instances).toHaveLength(1);
    unmount();
  });

  describe('stream lifecycle', () => {
    function mountStream() {
      const refreshBlueprintContent = vi.fn().mockResolvedValue(undefined);
      const reloadOpenFile = vi.fn();
      const rendered = renderHook(() => useBlueprintEvents({
        owner: 'numina',
        repo: 'math',
        blueprintId: 'froda',
        callbacks: {
          collaboration: { connected: false, synced: false },
          blueprint: null,
          isViewMounted: () => true,
          hasPendingLocalSave: () => false,
          deferRefreshUntilSaved: vi.fn(),
          refreshBlueprintContent,
          syncLatexSourceFromActiveChapter: vi.fn(),
          markBlueprintSynced: vi.fn(),
          reloadOpenFile,
        },
      }));
      return { ...rendered, refreshBlueprintContent, reloadOpenFile };
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reconnects with backoff and refreshes gaps before and after reopening', async () => {
      const { unmount, refreshBlueprintContent, reloadOpenFile } = mountStream();
      const first = MockEventSource.instances[0];
      first.readyState = MockEventSource.CLOSED;
      first.onerror?.(new Event('error'));

      await vi.advanceTimersByTimeAsync(499);
      expect(MockEventSource.instances).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(refreshBlueprintContent).toHaveBeenCalledOnce();
      expect(reloadOpenFile).toHaveBeenCalledOnce();

      MockEventSource.instances[1].onopen?.(new Event('open'));
      await Promise.resolve();
      expect(refreshBlueprintContent).toHaveBeenCalledTimes(2);
      unmount();
    });

    it('suspends a hidden stream after the debounce and refreshes on resume', async () => {
      let hidden = true;
      const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
      const { unmount, refreshBlueprintContent } = mountStream();
      const first = MockEventSource.instances[0];

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(4_999);
      expect(first.readyState).not.toBe(MockEventSource.CLOSED);
      await vi.advanceTimersByTimeAsync(1);
      expect(first.readyState).toBe(MockEventSource.CLOSED);

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      expect(MockEventSource.instances).toHaveLength(2);
      expect(refreshBlueprintContent).toHaveBeenCalledOnce();
      hiddenSpy.mockRestore();
      unmount();
    });

    it('cancels a scheduled reconnect during cleanup', async () => {
      const { unmount, refreshBlueprintContent } = mountStream();
      const source = MockEventSource.instances[0];
      source.readyState = MockEventSource.CLOSED;
      source.onerror?.(new Event('error'));

      unmount();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(MockEventSource.instances).toHaveLength(1);
      expect(refreshBlueprintContent).not.toHaveBeenCalled();
    });
  });

  describe('agent Lean edits', () => {
    function chatEvent(type: string, payload: object): Event {
      return new MessageEvent(type, { data: JSON.stringify(payload) });
    }

    function registeredHandler(eventName: string): (event: Event) => void {
      const call = chatOn.mock.calls.find(([name]) => name === eventName);
      if (!call) throw new Error(`no chat handler registered for ${eventName}`);
      return call[1] as (event: Event) => void;
    }

    function mountWithLeanView() {
      const reloadOpenFile = vi.fn().mockResolvedValue(false);
      const refreshBlueprintContent = vi.fn().mockResolvedValue(undefined);
      const rendered = renderHook(() => useBlueprintEvents({
        owner: 'numina',
        repo: 'math',
        blueprintId: 'froda',
        callbacks: {
          collaboration: { connected: false, synced: false },
          blueprint: null,
          isViewMounted: () => true,
          hasPendingLocalSave: () => false,
          deferRefreshUntilSaved: vi.fn(),
          refreshBlueprintContent,
          syncLatexSourceFromActiveChapter: vi.fn(),
          markBlueprintSynced: vi.fn(),
          reloadOpenFile,
        },
      }));
      return { ...rendered, reloadOpenFile, refreshBlueprintContent };
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('registers and unregisters both chat tool handlers', () => {
      const { unmount } = mountWithLeanView();
      const toolCall = registeredHandler('tool_call');
      const toolResult = registeredHandler('tool_result');
      unmount();
      expect(chatOff).toHaveBeenCalledWith('tool_call', toolCall);
      expect(chatOff).toHaveBeenCalledWith('tool_result', toolResult);
    });

    it('reloads the open Lean file when a Codex FileChange touches a .lean path', async () => {
      const { unmount, reloadOpenFile, refreshBlueprintContent } = mountWithLeanView();
      reloadOpenFile.mockResolvedValue(true);

      await act(async () => {
        registeredHandler('tool_call')(chatEvent('tool_call', {
          tool: 'FileChange',
          tool_use_id: 'item_1',
          input: {
            changes: [
              { path: '/repo/notes.md', kind: 'add' },
              { path: '/repo/Project/Basic.lean', kind: 'update' },
            ],
          },
        }));
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(refreshBlueprintContent).toHaveBeenCalledTimes(1);
      expect(reloadOpenFile).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('ignores FileChange calls that only touch non-Lean or metadata files', async () => {
      const { unmount, reloadOpenFile, refreshBlueprintContent } = mountWithLeanView();

      await act(async () => {
        registeredHandler('tool_call')(chatEvent('tool_call', {
          tool: 'FileChange',
          tool_use_id: 'item_2',
          input: {
            changes: [
              { path: '/repo/notes.md', kind: 'add' },
              { path: '/repo/.metadata/scratch/Try.lean', kind: 'add' },
            ],
          },
        }));
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(refreshBlueprintContent).not.toHaveBeenCalled();
      expect(reloadOpenFile).not.toHaveBeenCalled();
      unmount();
    });

    it('re-arms the reload when a permission-delayed write finally reports its result', async () => {
      const { unmount, reloadOpenFile, refreshBlueprintContent } = mountWithLeanView();

      await act(async () => {
        registeredHandler('tool_call')(chatEvent('tool_call', {
          tool: 'Edit',
          tool_use_id: 'toolu_1',
          input: { file_path: 'Project/Basic.lean', old_string: 'sorry', new_string: 'rfl' },
        }));
        // Exhaust the announce-time backoff while the user is still looking
        // at the permission prompt (the file has not changed yet).
        await vi.advanceTimersByTimeAsync(10_000);
      });
      const announceAttempts = reloadOpenFile.mock.calls.length;
      expect(announceAttempts).toBe(4);
      expect(refreshBlueprintContent).toHaveBeenCalledTimes(1);

      // The user approves; the write lands and its tool_result arrives.
      reloadOpenFile.mockResolvedValue(true);
      await act(async () => {
        registeredHandler('tool_result')(chatEvent('tool_result', {
          tool_use_id: 'toolu_1',
          result: null,
          is_error: false,
        }));
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(reloadOpenFile).toHaveBeenCalledTimes(announceAttempts + 1);
      expect(refreshBlueprintContent).toHaveBeenCalledTimes(2);

      // A second result for the same id (or an unknown id) is a no-op.
      await act(async () => {
        registeredHandler('tool_result')(chatEvent('tool_result', { tool_use_id: 'toolu_1', is_error: false }));
        registeredHandler('tool_result')(chatEvent('tool_result', { tool_use_id: 'toolu_other', is_error: false }));
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(reloadOpenFile).toHaveBeenCalledTimes(announceAttempts + 1);
      unmount();
    });

    it('does not reload after a denied or failed write', async () => {
      const { unmount, reloadOpenFile } = mountWithLeanView();

      await act(async () => {
        registeredHandler('tool_call')(chatEvent('tool_call', {
          tool: 'Write',
          tool_use_id: 'toolu_2',
          input: { file_path: 'Project/Basic.lean', content: 'theorem t : True := trivial' },
        }));
        await vi.advanceTimersByTimeAsync(10_000);
      });
      const announceAttempts = reloadOpenFile.mock.calls.length;

      await act(async () => {
        registeredHandler('tool_result')(chatEvent('tool_result', {
          tool_use_id: 'toolu_2',
          result: 'User denied permission',
          is_error: true,
        }));
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(reloadOpenFile).toHaveBeenCalledTimes(announceAttempts);
      unmount();
    });
  });

  it('applies target freshness events and requests a React state update', () => {
    const blueprint: { branch_freshness?: BranchFreshness | null } = {};
    const onBranchFreshness = vi.fn();
    const { unmount } = renderHook(() => useBlueprintEvents({
      owner: 'numina',
      repo: 'math',
      blueprintId: 'froda',
      callbacks: {
        collaboration: { connected: true, synced: true },
        blueprint,
        isViewMounted: () => false,
        hasPendingLocalSave: () => false,
        deferRefreshUntilSaved: vi.fn(),
        refreshBlueprintContent: vi.fn().mockResolvedValue(undefined),
        syncLatexSourceFromActiveChapter: vi.fn(),
        markBlueprintSynced: vi.fn(),
        reloadOpenFile: vi.fn(),
        onBranchFreshness,
      },
    }));
    const freshness: BranchFreshness = {
      default_branch: 'feature/chapter',
      base_sha: 'base-sha',
      current_default_sha: 'target-sha',
      commits_behind: 2,
      is_stale: true,
    };

    act(() => {
      MockEventSource.instances[0].emit('blueprint_branch_freshness', freshness);
    });

    expect(blueprint.branch_freshness).toEqual(freshness);
    expect(onBranchFreshness).toHaveBeenCalledWith(freshness);
    unmount();
  });
});
