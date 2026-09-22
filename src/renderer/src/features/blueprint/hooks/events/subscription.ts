import { makeBackoff } from '@/lib/sse';
import type { LeanInvalidationController } from './invalidation';
import type { BlueprintStreamHandlers } from './handlers';
import type {
  BlueprintEventRefs,
  ChatEventRegistry,
} from './types';

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 5000;
const HIDDEN_DISCONNECT_DELAY_MS = 5000;

interface SubscriptionIdentity {
  owner: string;
  repo: string;
  blueprintId: string;
}

export interface BlueprintEventSubscription {
  mount: () => void;
  unmount: () => void;
}

interface SubscriptionState {
  identity: SubscriptionIdentity;
  refs: BlueprintEventRefs;
  handlers: BlueprintStreamHandlers;
  leanInvalidation: LeanInvalidationController;
  source: EventSource | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  hiddenTimer: ReturnType<typeof setTimeout> | null;
  suspended: boolean;
  hadError: boolean;
  mountedChatRegistry: ChatEventRegistry | null;
  reconnectBackoff: ReturnType<typeof makeBackoff>;
}

function streamUrl(identity: SubscriptionIdentity, runtimeTag: string | null): string {
  const owner = encodeURIComponent(identity.owner);
  const repo = encodeURIComponent(identity.repo);
  const blueprint = encodeURIComponent(identity.blueprintId);
  const query = runtimeTag ? `?runtime=${runtimeTag}` : '';
  return `/api/repositories/${owner}/${repo}/blueprints/${blueprint}/events${query}`;
}

function clearReconnectTimer(state: SubscriptionState, resetDelay = true): void {
  if (state.reconnectTimer !== null) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (resetDelay) state.reconnectBackoff.reset();
}

function unsubscribe(state: SubscriptionState): void {
  clearReconnectTimer(state);
  state.source?.close();
  state.source = null;
}

function reconnect(state: SubscriptionState): void {
  clearReconnectTimer(state);
  unsubscribe(state);
  subscribe(state);
  void state.handlers.refreshAfterGap();
}

function scheduleReconnect(state: SubscriptionState): void {
  if (state.reconnectTimer !== null || document.hidden || state.suspended) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    reconnect(state);
  }, state.reconnectBackoff.next());
}

function bindStreamListeners(state: SubscriptionState, source: EventSource): void {
  const handlers = state.handlers;
  source.addEventListener('blueprint_edit', handlers.blueprintEdit);
  source.addEventListener('build_snapshot', handlers.buildSnapshot);
  source.addEventListener('build_errors_snapshot', handlers.buildErrors);
  source.addEventListener('build_errors_updated', handlers.buildErrors);
  source.addEventListener('build_status', handlers.buildStatus);
  source.addEventListener('ocr_snapshot', handlers.ocrPhase);
  source.addEventListener('ocr_status', handlers.ocrPhase);
  source.addEventListener('buffer_overflow', () => reconnect(state));
  source.addEventListener('blueprint_sync', handlers.fullRefresh);
  source.addEventListener('blueprint_rebase', handlers.fullRefresh);
  source.addEventListener('blueprint_branch_status', handlers.branchStatus);
  source.addEventListener('blueprint_branch_freshness', handlers.branchFreshness);
}

function bindConnectionLifecycle(state: SubscriptionState, source: EventSource): void {
  source.onopen = () => {
    clearReconnectTimer(state);
    if (!state.hadError) return;
    state.hadError = false;
    void state.handlers.refreshAfterGap();
  };
  source.onerror = () => {
    state.hadError = true;
    if (state.source?.readyState === EventSource.CLOSED) scheduleReconnect(state);
  };
}

function subscribe(state: SubscriptionState): void {
  clearReconnectTimer(state);
  const source = new EventSource(
    streamUrl(state.identity, state.refs.runtimeTag.current),
    { withCredentials: true },
  );
  state.source = source;
  bindStreamListeners(state, source);
  bindConnectionLifecycle(state, source);
}

function handleVisibilityChange(state: SubscriptionState): void {
  if (document.hidden) {
    clearReconnectTimer(state);
    if (state.hiddenTimer !== null || !state.source) return;
    state.hiddenTimer = setTimeout(() => {
      state.hiddenTimer = null;
      unsubscribe(state);
      state.suspended = true;
    }, HIDDEN_DISCONNECT_DELAY_MS);
    return;
  }
  if (state.hiddenTimer !== null) clearTimeout(state.hiddenTimer);
  state.hiddenTimer = null;
  if (!state.suspended) return;
  state.suspended = false;
  subscribe(state);
  void state.handlers.refreshAfterGap();
}

function mount(state: SubscriptionState, visibilityListener: () => void): void {
  subscribe(state);
  document.addEventListener('visibilitychange', visibilityListener);
  state.mountedChatRegistry = state.refs.chatRegistry.current;
  state.mountedChatRegistry.on('tool_call', state.leanInvalidation.onToolCall);
  state.mountedChatRegistry.on('tool_result', state.leanInvalidation.onToolResult);
}

function unmount(state: SubscriptionState, visibilityListener: () => void): void {
  state.mountedChatRegistry?.off('tool_call', state.leanInvalidation.onToolCall);
  state.mountedChatRegistry?.off('tool_result', state.leanInvalidation.onToolResult);
  state.leanInvalidation.cleanup();
  document.removeEventListener('visibilitychange', visibilityListener);
  if (state.hiddenTimer !== null) clearTimeout(state.hiddenTimer);
  unsubscribe(state);
}

/** Owns EventSource reconnect, hidden-tab suspension, and symmetric cleanup. */
export function createBlueprintEventSubscription(
  identity: SubscriptionIdentity,
  refs: BlueprintEventRefs,
  handlers: BlueprintStreamHandlers,
  leanInvalidation: LeanInvalidationController,
): BlueprintEventSubscription {
  const state: SubscriptionState = {
    identity,
    refs,
    handlers,
    leanInvalidation,
    source: null,
    reconnectTimer: null,
    hiddenTimer: null,
    suspended: false,
    hadError: false,
    mountedChatRegistry: null,
    reconnectBackoff: makeBackoff({
      initialMs: RECONNECT_INITIAL_MS,
      maxMs: RECONNECT_MAX_MS,
    }),
  };
  const visibilityListener = () => handleVisibilityChange(state);
  return {
    mount: () => mount(state, visibilityListener),
    unmount: () => unmount(state, visibilityListener),
  };
}
