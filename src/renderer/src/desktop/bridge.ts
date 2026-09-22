/**
 * Guarded access to the `window.fuse` bridge the preload script exposes.
 *
 * The renderer also runs in plain browsers (Vite dev server, vitest/jsdom,
 * the screenshot harness), where the bridge is absent. Every native call goes
 * through these helpers so callers never touch `window.fuse` directly and the
 * absence of the bridge degrades to "not available" instead of a TypeError.
 */

import type { DesktopApi } from '@shared/desktop';
import { registerRepository, type RegisteredRepository } from '@/lib/api/repositories';
import { reloadDashboardRepositories } from '@/state/dashboard';

/** The bridge, or `null` outside Electron. */
export function desktopApi(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  // The preload types declare `window.fuse` as always present; at runtime it
  // is only there inside the Electron renderer.
  return (window as { fuse?: DesktopApi }).fuse ?? null;
}

export function isDesktop(): boolean {
  return desktopApi() !== null;
}

/** Route of a repository page, encoding both segments. */
export function repositoryRoute(repository: { owner: string; name: string }): string {
  return `/repo/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}

/**
 * Open the native folder picker. Resolves `null` when the bridge is missing
 * or the user cancelled.
 */
export async function pickFolder(): Promise<string | null> {
  const api = desktopApi();
  if (!api) return null;
  const path = await api.dialog.pickFolder();
  return path && path.trim() ? path : null;
}

/**
 * Register a folder as a repository and refresh the dashboard list so the new
 * row is visible wherever the list is rendered next. The dashboard refresh is
 * best effort: a failure there must not hide the successful registration.
 */
export async function openFolderAsRepository(path: string): Promise<RegisteredRepository> {
  const repository = await registerRepository(path);
  await reloadDashboardRepositories().catch(() => {});
  return repository;
}

/**
 * The "Open folder" gesture shared by the dashboard, the New Project wizard,
 * the native menu and a window drop: pick, register, refresh. Resolves `null`
 * when nothing was picked.
 */
export async function pickAndRegisterFolder(): Promise<RegisteredRepository | null> {
  const path = await pickFolder();
  if (!path) return null;
  return openFolderAsRepository(path);
}

/** Reveal a folder in the OS file manager; a no-op outside Electron. */
export function showInFolder(path: string): void {
  void desktopApi()?.shell.showInFolder(path);
}
