import { describe, expect, it, vi } from 'vitest';

import { createBlueprintStreamHandlers } from '@/features/blueprint/hooks/events/handlers';
import {
  eventBuildSnapshot,
  eventFiles,
  eventLatexSource,
  eventPhase,
} from '@/features/blueprint/hooks/events/normalization';
import type {
  BlueprintEventCallbacks,
  BlueprintEventRefs,
} from '@/features/blueprint/hooks/events/types';

function event(payload: unknown): Event {
  return new MessageEvent('message', { data: JSON.stringify(payload) });
}

function callbacks(
  overrides: Partial<BlueprintEventCallbacks> = {},
): BlueprintEventCallbacks {
  return {
    collaboration: { connected: false, synced: false },
    blueprint: {},
    isViewMounted: () => false,
    hasPendingLocalSave: () => false,
    deferRefreshUntilSaved: vi.fn(),
    refreshBlueprintContent: vi.fn().mockResolvedValue(undefined),
    syncLatexSourceFromActiveChapter: vi.fn(),
    markBlueprintSynced: vi.fn(),
    reloadOpenFile: vi.fn(),
    ...overrides,
  };
}

function setup(currentCallbacks = callbacks()) {
  const refs: BlueprintEventRefs = {
    callbacks: { current: currentCallbacks },
    ocrStatus: { current: null },
    runtimeTag: { current: null },
    chatRegistry: { current: { on: vi.fn(), off: vi.fn() } },
  };
  const setters = {
    setBuildStatus: vi.fn(),
    setBuildErrors: vi.fn(),
    applyBuildPhase: vi.fn(),
    applyOcrPhase: vi.fn(),
  };
  return {
    refs,
    setters,
    handlers: createBlueprintStreamHandlers(refs, setters),
  };
}

describe('blueprint event normalization', () => {
  it('normalizes valid phase, files, edit, and snapshot payloads', () => {
    expect(eventPhase(event({ phase: 'running' }))).toBe('running');
    expect(eventFiles(event({ files: { 'Main.lean': 2 } }))).toEqual({ 'Main.lean': 2 });
    expect(eventLatexSource(event({ latex_source: 'updated' }))).toBe('updated');
    expect(eventBuildSnapshot(event({ status: 'done', steps: [1] }))).toEqual({
      done: true,
      hasSteps: true,
    });
  });

  it('rejects malformed payload fields without throwing', () => {
    expect(eventPhase(event({ phase: 42 }))).toBe(false);
    expect(eventFiles(event({ files: 'bad' }))).toBeNull();
    expect(eventLatexSource(event({ latex_source: null }))).toBeNull();
    expect(eventBuildSnapshot(new MessageEvent('message', { data: '{bad' }))).toBeNull();
  });
});

describe('blueprint stream handlers', () => {
  it('applies external edits or defers them behind a local save', () => {
    const current = callbacks();
    const { refs, handlers } = setup(current);
    handlers.blueprintEdit(event({ latex_source: 'first' }));
    expect(current.blueprint?.blueprint_content).toBe('first');
    expect(current.syncLatexSourceFromActiveChapter).toHaveBeenCalledOnce();

    refs.callbacks.current = callbacks({ hasPendingLocalSave: () => true });
    handlers.blueprintEdit(event({ latex_source: 'deferred' }));
    expect(refs.callbacks.current.deferRefreshUntilSaved).toHaveBeenCalledOnce();
    expect(refs.callbacks.current.blueprint?.blueprint_content).toBeUndefined();

    refs.callbacks.current = callbacks({ collaboration: { connected: true, synced: true } });
    handlers.blueprintEdit(event({ latex_source: 'ignored' }));
    expect(refs.callbacks.current.syncLatexSourceFromActiveChapter).not.toHaveBeenCalled();
  });

  it('routes build snapshots, errors, and valid phases to state setters', () => {
    const { handlers, setters } = setup();
    handlers.buildSnapshot(event({ status: 'working', steps: [{}] }));
    handlers.buildSnapshot(event({ status: 'done', steps: [] }));
    handlers.buildErrors(event({ files: { 'Main.lean': { errors: 1 } } }));
    handlers.buildStatus(event({ phase: 'building' }));

    expect(setters.setBuildStatus).toHaveBeenNthCalledWith(1, 'running');
    expect(setters.setBuildStatus).toHaveBeenNthCalledWith(2, 'done');
    expect(setters.setBuildErrors).toHaveBeenCalledWith({
      'Main.lean': { errors: 1 },
    });
    expect(setters.applyBuildPhase).toHaveBeenCalledWith('building');
  });

  it('refreshes blueprint and mounted sources only on the OCR complete transition', async () => {
    const refreshSources = vi.fn().mockResolvedValue(undefined);
    const current = callbacks({
      isSourceMounted: () => true,
      refreshRepositorySources: refreshSources,
    });
    const { refs, handlers, setters } = setup(current);

    handlers.ocrPhase(event({ phase: 'complete' }));
    await Promise.resolve();
    expect(current.refreshBlueprintContent).toHaveBeenCalledOnce();
    expect(refreshSources).toHaveBeenCalledOnce();
    expect(setters.applyOcrPhase).toHaveBeenCalledWith('complete');

    refs.ocrStatus.current = 'complete';
    handlers.ocrPhase(event({ phase: 'complete' }));
    expect(current.refreshBlueprintContent).toHaveBeenCalledOnce();
  });

  it('refreshes after stream gaps before clearing a synced baseline', async () => {
    const order: string[] = [];
    const current = callbacks({
      collaboration: { connected: true, synced: true },
      blueprint: { ocr_phase: 'processing' },
      isViewMounted: () => true,
      refreshBlueprintContent: vi.fn(async () => { order.push('refresh'); }),
      reloadOpenFile: vi.fn(() => { order.push('reload'); return true; }),
      markBlueprintSynced: vi.fn(() => { order.push('synced'); }),
    });
    const { handlers, setters } = setup(current);

    await handlers.fullRefresh();

    expect(order).toEqual(['refresh', 'reload', 'synced']);
    expect(setters.applyOcrPhase).toHaveBeenCalledWith('processing');
  });

  it('mutates branch payloads and invokes React invalidation callbacks', () => {
    const onBranchStatus = vi.fn();
    const onBranchFreshness = vi.fn();
    const current = callbacks({ onBranchStatus, onBranchFreshness });
    const { handlers } = setup(current);
    const status = { branch: 'main', is_dirty: true };
    const freshness = { is_stale: true, commits_behind: 2 };

    handlers.branchStatus(event(status));
    handlers.branchFreshness(event(freshness));

    expect(current.blueprint?.branch_status).toEqual(status);
    expect(current.blueprint?.branch_freshness).toEqual(freshness);
    expect(onBranchStatus).toHaveBeenCalledWith(status);
    expect(onBranchFreshness).toHaveBeenCalledWith(freshness);
  });
});
