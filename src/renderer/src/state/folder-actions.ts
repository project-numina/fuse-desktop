/**
 * Error line for the dashboard's folder actions (open a folder, remove one
 * from the list).
 *
 * A module-level store rather than page state because the folder can also be
 * opened from the native menu or by dropping it on the window, where no page
 * is mounted to own the error. The shell records the failure here and sends
 * the user to the dashboard, which renders whatever is pending.
 */

import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';

let message: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return message;
}

/** Set (or clear, with `null`) the error the dashboard shows. */
export function setFolderActionError(next: string | null): void {
  if (next === message) return;
  message = next;
  for (const listener of listeners) listener();
}

/** The only route that renders the error line. */
const DASHBOARD_PATH = '/';

/**
 * Called on every navigation: the error belongs to the dashboard, so leaving
 * it drops the message the way page-local state would. (Clearing in the
 * dashboard's own unmount cleanup would misfire under StrictMode, whose
 * simulated unmount runs between a menu-driven failure and the first paint.)
 */
export function clearFolderActionErrorOnLeave(pathname: string): void {
  if (pathname !== DASHBOARD_PATH) setFolderActionError(null);
}

/**
 * The message to show for a failed folder action: the backend's own detail
 * when the failure is an API error (`Folder not found: …`), else `fallback`.
 */
export function folderActionErrorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

export const OPEN_FOLDER_FALLBACK = 'Could not open that folder. Please try again.';

export function useFolderActionError(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
