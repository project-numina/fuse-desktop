import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuCommand } from '@shared/desktop';

const theme = vi.hoisted(() => ({ theme: 'system', toggle: vi.fn() }));
const bridge = vi.hoisted(() => ({
  pickAndRegisterFolder: vi.fn(),
  openFolderAsRepository: vi.fn(),
  repositoryRoute: (repository: { owner: string; name: string }) => `/repo/${repository.owner}/${repository.name}`,
  desktopApi: vi.fn(),
}));
const folderActions = vi.hoisted(() => ({ setFolderActionError: vi.fn() }));
vi.mock('@/state/theme', () => ({ useTheme: () => theme }));
vi.mock('@/desktop/bridge', () => bridge);
vi.mock('@/state/folder-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/state/folder-actions')>()),
  setFolderActionError: folderActions.setFolderActionError,
}));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error { constructor(message: string, public status: number) { super(message); } } }));

import { ApiError } from '@/lib/api';
import DesktopIntegration, { newWorkspaceRoute, type ShellRouter } from '@/desktop/DesktopIntegration';
import { FOCUS_COMPOSER_EVENT, STOP_TURN_EVENT } from '@/desktop/events';

interface TestRouter extends ShellRouter {
  subscribe: ReturnType<typeof vi.fn<ShellRouter['subscribe']>>;
  navigate: ReturnType<typeof vi.fn<ShellRouter['navigate']>>;
  emit: (pathname: string, hash?: string) => void;
}

function makeRouter(): TestRouter {
  const listeners = new Set<(state: ShellRouter['state']) => void>();
  const router: TestRouter = {
    state: { location: { pathname: '/', search: '', hash: '' } },
    subscribe: vi.fn<ShellRouter['subscribe']>((listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    navigate: vi.fn<ShellRouter['navigate']>(async () => {}),
    emit(pathname: string, hash = '') {
      router.state = { location: { pathname, search: '?x=1', hash } };
      for (const listener of listeners) listener(router.state);
    },
  };
  return router;
}

let menuListener: ((command: MenuCommand) => void) | null = null;
const fuse = {
  theme: { set: vi.fn() },
  settings: { update: vi.fn(), get: vi.fn() },
  menu: { onCommand: vi.fn((listener: (command: MenuCommand) => void) => { menuListener = listener; return () => { menuListener = null; }; }) },
  dialog: { pathForFile: vi.fn(), pickFolder: vi.fn() },
};

describe('DesktopIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    menuListener = null;
    bridge.desktopApi.mockReturnValue(fuse);
    fuse.settings.update.mockResolvedValue({});
    fuse.theme.set.mockResolvedValue(undefined);
    bridge.pickAndRegisterFolder.mockResolvedValue({ id: 1, owner: 'home', name: 'proj' });
    bridge.openFolderAsRepository.mockResolvedValue({ id: 2, owner: 'home', name: 'dropped' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is inert without the bridge', () => {
    bridge.desktopApi.mockReturnValue(null);
    const router = makeRouter();
    render(<DesktopIntegration router={router} />);
    expect(router.subscribe).not.toHaveBeenCalled();
    expect(fuse.menu.onCommand).not.toHaveBeenCalled();
  });

  it('mirrors the theme preference into the native window and persists it', () => {
    render(<DesktopIntegration router={makeRouter()} />);
    expect(fuse.theme.set).toHaveBeenCalledWith('system');
    expect(fuse.settings.update).toHaveBeenCalledWith({ theme: 'system' });
  });

  it('routes menu commands', async () => {
    const router = makeRouter();
    render(<DesktopIntegration router={router} />);
    const focus = vi.fn();
    const stop = vi.fn();
    window.addEventListener(FOCUS_COMPOSER_EVENT, focus);
    window.addEventListener(STOP_TURN_EVENT, stop);
    try {
      const send = (command: MenuCommand) => act(() => { menuListener?.(command); });
      send('go-home'); send('go-chats'); send('go-sessions'); send('new-workspace'); send('settings');
      send({ kind: 'navigate', path: '/guide' });
      expect(router.navigate.mock.calls.map((call) => call[0])).toEqual(['/', '/chats', '/sessions', '/', '/account', '/guide']);
      // Inside a repository, New Workspace opens that repository's form.
      router.state = { location: { pathname: '/repo/home/proj/blueprint/b/lean', search: '', hash: '' } };
      send('new-workspace');
      expect(router.navigate).toHaveBeenLastCalledWith('/repo/home/proj/blueprint/new');
      send('toggle-theme');
      expect(theme.toggle).toHaveBeenCalledOnce();
      send('focus-composer'); send('stop-turn');
      expect(focus).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
      send('open-repository');
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(bridge.pickAndRegisterFolder).toHaveBeenCalledOnce();
      expect(router.navigate).toHaveBeenLastCalledWith('/repo/home/proj');
      expect(folderActions.setFolderActionError).toHaveBeenCalledWith(null);
    } finally {
      window.removeEventListener(FOCUS_COMPOSER_EVENT, focus);
      window.removeEventListener(STOP_TURN_EVENT, stop);
    }
  });

  it('persists the route after navigation settles, skipping transient wizards', () => {
    vi.useFakeTimers();
    const router = makeRouter();
    render(<DesktopIntegration router={router} />);
    const routeWrites = () => fuse.settings.update.mock.calls.filter(([patch]) => 'lastRoute' in patch);
    act(() => { router.emit('/repo/home/proj'); router.emit('/repo/home/proj/blueprint/b/lean'); });
    expect(routeWrites()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(600); });
    expect(routeWrites()).toEqual([[{ lastRoute: '/repo/home/proj/blueprint/b/lean?x=1' }]]);
    act(() => { router.emit('/new'); router.emit('/repo/home/proj/blueprint/new'); vi.advanceTimersByTime(600); });
    expect(routeWrites()).toHaveLength(1);
  });

  // Main appends `?fuse_token=` to the stored route on launch; a fragment in
  // it would swallow the token and leave every API call unauthenticated.
  it('never persists the URL hash', () => {
    vi.useFakeTimers();
    const router = makeRouter();
    render(<DesktopIntegration router={router} />);
    act(() => { router.emit('/repo/home/proj/blueprint/b', '#1.2'); vi.advanceTimersByTime(600); });
    expect(fuse.settings.update).toHaveBeenCalledWith({ lastRoute: '/repo/home/proj/blueprint/b?x=1' });
    // Only the hash changing is not a new route to store.
    act(() => { router.emit('/repo/home/proj/blueprint/b', '#1.3'); vi.advanceTimersByTime(600); });
    expect(fuse.settings.update.mock.calls.filter(([patch]) => 'lastRoute' in patch)).toHaveLength(1);
  });

  it('reports a failed menu-driven open on the dashboard', async () => {
    const router = makeRouter();
    router.state = { location: { pathname: '/repo/home/proj', search: '', hash: '' } };
    render(<DesktopIntegration router={router} />);
    bridge.pickAndRegisterFolder.mockRejectedValueOnce(new ApiError('Folder not found: /nope', 404));
    act(() => { menuListener?.('open-repository'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(folderActions.setFolderActionError).toHaveBeenLastCalledWith('Folder not found: /nope');
    expect(router.navigate).toHaveBeenCalledWith('/');

    bridge.pickAndRegisterFolder.mockRejectedValueOnce(new Error('ipc broke'));
    act(() => { menuListener?.('open-repository'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(folderActions.setFolderActionError).toHaveBeenLastCalledWith('Could not open that folder. Please try again.');
  });

  it('opens a dropped folder and ignores dropped files', async () => {
    const router = makeRouter();
    render(<DesktopIntegration router={router} />);
    const file = new File([''], 'proj');
    fuse.dialog.pathForFile.mockReturnValue('/home/ada/proj');
    const drop = (isDirectory: boolean) => {
      const event = new Event('drop', { cancelable: true, bubbles: true }) as DragEvent;
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: ['Files'],
          files: [file],
          items: [{ webkitGetAsEntry: () => ({ isDirectory }) }],
        },
      });
      window.dispatchEvent(event);
      return event;
    };
    const fileDrop = drop(false);
    expect(fileDrop.defaultPrevented).toBe(true);
    expect(bridge.openFolderAsRepository).not.toHaveBeenCalled();

    drop(true);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.openFolderAsRepository).toHaveBeenCalledWith('/home/ada/proj');
    expect(router.navigate).toHaveBeenCalledWith('/repo/home/dropped');

    bridge.openFolderAsRepository.mockRejectedValueOnce(new ApiError('Folder not found: /home/ada/proj', 404));
    drop(true);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(folderActions.setFolderActionError).toHaveBeenLastCalledWith('Folder not found: /home/ada/proj');
    expect(router.navigate).toHaveBeenLastCalledWith('/');
  });

  it('maps New Workspace to the repository form only inside a repository', () => {
    expect(newWorkspaceRoute('/')).toBe('/');
    expect(newWorkspaceRoute('/sessions')).toBe('/');
    expect(newWorkspaceRoute('/new')).toBe('/');
    expect(newWorkspaceRoute('/repo/home/proj')).toBe('/repo/home/proj/blueprint/new');
    expect(newWorkspaceRoute('/repo/home/proj/blueprint/b/lean')).toBe('/repo/home/proj/blueprint/new');
    expect(newWorkspaceRoute('/repo/a%20b/c%2Fd/blueprint/new')).toBe('/repo/a%20b/c%2Fd/blueprint/new');
  });
});
