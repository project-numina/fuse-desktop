/**
 * Push notification opt-in — disabled stub.
 *
 * The hosted app subscribed the browser to web push through a service worker
 * and VAPID keys on the server. Fuse Desktop raises native notifications from
 * the main process instead, so there is nothing for the renderer to subscribe
 * to. The hook keeps its shape (`state`, `supported`, `refresh`, `enable`,
 * `disable`) and always reports push as unsupported/unavailable so any caller
 * that still consults it hides its toggle.
 */

import { useSyncExternalStore } from 'react';

interface PushState {
  /** Current Notification permission, or 'unsupported'. */
  permission: NotificationPermission | 'unsupported';
  /** Whether a server could deliver web push. Never true locally. */
  available: boolean;
  /** Whether an active push subscription exists. Never true locally. */
  subscribed: boolean;
  /** True once refresh() has resolved at least once (immediately here). */
  loaded: boolean;
  /** True while an enable/disable request is in flight. Never true locally. */
  busy: boolean;
  /** Human-readable error from the last action, or null. */
  error: string | null;
}

const state: PushState = {
  permission: 'unsupported',
  available: false,
  subscribed: false,
  loaded: true,
  busy: false,
  error: null,
};

// The state never changes, so subscribers are never notified.
function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): PushState {
  return state;
}

async function refresh(): Promise<void> {}

async function enable(): Promise<boolean> {
  return false;
}

async function disable(): Promise<void> {}

/** Imperative teardown kept for callers outside React; a no-op locally. */
export async function disablePushNotifications(): Promise<void> {
  await disable();
}

/** React surface with the same shape as the web hook. */
export function usePushNotifications() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    state: snapshot,
    supported: false,
    refresh,
    enable,
    disable,
  };
}
