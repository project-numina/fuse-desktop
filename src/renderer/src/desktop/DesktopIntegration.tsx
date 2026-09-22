import { useEffect, useRef } from 'react';
import type { MenuCommand } from '@shared/desktop';
import { useTheme } from '@/state/theme';
import { desktopApi, pickAndRegisterFolder, openFolderAsRepository, repositoryRoute } from '@/desktop/bridge';
import { dispatchShellEvent, FOCUS_COMPOSER_EVENT, STOP_TURN_EVENT } from '@/desktop/events';
import {
  folderActionErrorMessage,
  OPEN_FOLDER_FALLBACK,
  setFolderActionError,
} from '@/state/folder-actions';

/** The slice of the data router the shell needs; kept narrow for tests. */
export interface ShellRouter {
  state: { location: { pathname: string; search: string; hash: string } };
  subscribe(listener: (state: ShellRouter['state']) => void): () => void;
  navigate(to: string): Promise<void>;
}

/** Wait this long after the last navigation before writing `lastRoute`. */
const LAST_ROUTE_DEBOUNCE_MS = 500;

/**
 * Routes that make no sense to reopen on launch: the creation wizards are
 * transient, and landing in one after a restart would look like lost work.
 */
function isRestorableRoute(pathname: string): boolean {
  return pathname !== '/new' && !pathname.endsWith('/blueprint/new');
}

/**
 * The part of a location worth restoring. The hash is deliberately dropped:
 * the blueprint Overview writes declaration anchors into it, and main appends
 * `?fuse_token=…` to the stored route on launch, so a persisted fragment would
 * swallow the token (`/…#1.2?fuse_token=…`) and every `/api` call would 401.
 */
function restorablePath(state: ShellRouter['state']): string {
  const { pathname, search } = state.location;
  return `${pathname}${search}`;
}

/**
 * Where File > New Workspace goes. Inside a repository (any `/repo/:owner/:repo`
 * page) that is the repository's New workspace form; elsewhere the dashboard,
 * where the user picks the repository first. `/new` is the Lean-project setup
 * wizard, a different flow.
 */
export function newWorkspaceRoute(pathname: string): string {
  const match = /^\/repo\/([^/]+)\/([^/]+)/.exec(pathname);
  return match ? `/repo/${match[1]}/${match[2]}/blueprint/new` : '/';
}

/**
 * A menu- or drop-driven registration failed. There is no page to own the
 * error, so record it and show the dashboard, which renders the message
 * inline exactly as it does for its own "Open folder" button.
 */
function reportOpenFailure(router: ShellRouter, caught: unknown): void {
  setFolderActionError(folderActionErrorMessage(caught, OPEN_FOLDER_FALLBACK));
  void router.navigate('/');
}

/** Whether a drag carries OS files (as opposed to in-page text/elements). */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * The first dropped item when it is a directory. Chromium exposes the entry
 * kind through `webkitGetAsEntry`; a plain file drop is left alone so the
 * workspace's own upload targets keep their behaviour.
 */
function droppedDirectory(event: DragEvent): File | null {
  const item = event.dataTransfer?.items?.[0];
  const file = event.dataTransfer?.files?.[0];
  if (!item || !file) return null;
  const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null })
    .webkitGetAsEntry?.();
  return entry?.isDirectory ? file : null;
}

/**
 * Glue between the native shell and the React app: menu commands, theme
 * mirroring into the window chrome, `lastRoute` persistence, and "drop a
 * folder anywhere to open it". Renders nothing. Every bridge call is guarded
 * so the component is inert in a plain browser.
 */
export default function DesktopIntegration({ router }: { router: ShellRouter }) {
  const { theme, toggle } = useTheme();

  // Keep the latest toggle in a ref so the menu subscription (registered once)
  // never calls a stale closure.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // Mirror the preference into `nativeTheme` so dialogs and the window
  // background follow the in-app theme, and persist it so the next launch can
  // paint the window in the right colours before React mounts.
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    void api.theme.set(theme);
    void api.settings.update({ theme }).catch(() => {});
  }, [theme]);

  // Persist the route the user is on so the next launch reopens it.
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastWritten: string | null = null;
    const persist = (state: ShellRouter['state']) => {
      if (!isRestorableRoute(state.location.pathname)) return;
      const next = restorablePath(state);
      if (next === lastWritten) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        lastWritten = next;
        void api.settings.update({ lastRoute: next }).catch(() => {});
      }, LAST_ROUTE_DEBOUNCE_MS);
    };
    const unsubscribe = router.subscribe(persist);
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [router]);

  // Native menu and shortcut commands.
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    const go = (path: string) => void router.navigate(path);
    const handle = (command: MenuCommand) => {
      if (typeof command === 'object') {
        go(command.path);
        return;
      }
      switch (command) {
        case 'go-home':
          go('/');
          break;
        case 'go-chats':
          go('/chats');
          break;
        case 'go-sessions':
          go('/sessions');
          break;
        case 'new-workspace':
          go(newWorkspaceRoute(router.state.location.pathname));
          break;
        case 'settings':
          go('/account');
          break;
        case 'toggle-theme':
          toggleRef.current();
          break;
        case 'focus-composer':
          dispatchShellEvent(FOCUS_COMPOSER_EVENT);
          break;
        case 'stop-turn':
          dispatchShellEvent(STOP_TURN_EVENT);
          break;
        case 'open-repository':
          setFolderActionError(null);
          void pickAndRegisterFolder()
            .then((repository) => {
              if (repository) go(repositoryRoute(repository));
            })
            .catch((caught: unknown) => reportOpenFailure(router, caught));
          break;
      }
    };
    return api.menu.onCommand(handle);
  }, [router]);

  // Drop a folder anywhere on the window to open it as a repository.
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    const onDragOver = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      // A drop target inside the page (source upload, attachment picker)
      // accepted the drop already; leave it alone.
      if (event.defaultPrevented || !carriesFiles(event)) return;
      // Always swallow stray file drops: otherwise Chromium navigates the
      // window to the dropped file.
      event.preventDefault();
      const directory = droppedDirectory(event);
      if (!directory) return;
      const path = api.dialog.pathForFile(directory);
      if (!path) return;
      setFolderActionError(null);
      void openFolderAsRepository(path)
        .then((repository) => void router.navigate(repositoryRoute(repository)))
        .catch((caught: unknown) => reportOpenFailure(router, caught));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [router]);

  return null;
}
