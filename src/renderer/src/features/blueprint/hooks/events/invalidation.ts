import { isLeanFileWriteToolCall } from '@/features/blueprint/lib/blueprint-helpers';
import { parseSseEventData } from '@/lib/sse';
import type { BlueprintEventRefs } from './types';

const LEAN_FILE_RELOAD_BACKOFFS_MS = [150, 350, 750, 1500];
const MAX_PENDING_LEAN_WRITE_IDS = 64;

export interface LeanInvalidationController {
  onToolCall: (event: Event) => void;
  onToolResult: (event: Event) => void;
  cleanup: () => void;
}

interface LeanInvalidationState {
  refs: BlueprintEventRefs;
  refreshTimeout: ReturnType<typeof setTimeout> | null;
  fileReloadTimeout: ReturnType<typeof setTimeout> | null;
  pendingWriteIds: Set<string>;
}

function scheduleRefresh(state: LeanInvalidationState): void {
  if (!state.refs.callbacks.current.isViewMounted()) return;
  if (state.refreshTimeout) clearTimeout(state.refreshTimeout);
  state.refreshTimeout = setTimeout(() => {
    void state.refs.callbacks.current.refreshBlueprintContent().catch(() => {
      // A later invalidation or stream refresh retries.
    });
  }, 200);
}

function scheduleFileReload(state: LeanInvalidationState, attempt = 0): void {
  if (!state.refs.callbacks.current.isViewMounted()) return;
  if (state.fileReloadTimeout) clearTimeout(state.fileReloadTimeout);
  state.fileReloadTimeout = setTimeout(async () => {
    let changed = false;
    try {
      changed = (await state.refs.callbacks.current.reloadOpenFile()) ?? false;
    } catch {
      // Continue the bounded retry schedule after transient failures.
    }
    if (!changed && attempt + 1 < LEAN_FILE_RELOAD_BACKOFFS_MS.length) {
      scheduleFileReload(state, attempt + 1);
    }
  }, LEAN_FILE_RELOAD_BACKOFFS_MS[attempt]);
}

function rememberWrite(state: LeanInvalidationState, id: string): void {
  state.pendingWriteIds.add(id);
  if (state.pendingWriteIds.size <= MAX_PENDING_LEAN_WRITE_IDS) return;
  const oldest = state.pendingWriteIds.values().next().value;
  if (oldest !== undefined) state.pendingWriteIds.delete(oldest);
}

function invalidateLeanView(state: LeanInvalidationState): void {
  scheduleRefresh(state);
  scheduleFileReload(state);
}

function onToolCall(state: LeanInvalidationState, event: Event): void {
  const data = parseSseEventData<{
    tool?: unknown;
    input?: unknown;
    tool_use_id?: unknown;
  }>(event);
  if (!data || !isLeanFileWriteToolCall(data.tool, data.input)) return;
  if (typeof data.tool_use_id === 'string') rememberWrite(state, data.tool_use_id);
  invalidateLeanView(state);
}

function onToolResult(state: LeanInvalidationState, event: Event): void {
  const data = parseSseEventData<{ tool_use_id?: unknown; is_error?: unknown }>(event);
  if (!data || typeof data.tool_use_id !== 'string') return;
  if (!state.pendingWriteIds.delete(data.tool_use_id) || data.is_error === true) return;
  invalidateLeanView(state);
}

function cleanup(state: LeanInvalidationState): void {
  state.pendingWriteIds.clear();
  if (state.refreshTimeout) clearTimeout(state.refreshTimeout);
  if (state.fileReloadTimeout) clearTimeout(state.fileReloadTimeout);
}

export function createLeanInvalidationController(
  refs: BlueprintEventRefs,
): LeanInvalidationController {
  const state: LeanInvalidationState = {
    refs,
    refreshTimeout: null,
    fileReloadTimeout: null,
    pendingWriteIds: new Set<string>(),
  };
  return {
    onToolCall: (event) => onToolCall(state, event),
    onToolResult: (event) => onToolResult(state, event),
    cleanup: () => cleanup(state),
  };
}
