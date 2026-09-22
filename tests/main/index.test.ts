import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DESKTOP_IPC } from '@shared/desktop';

vi.mock('@main/updates', () => ({ startUpdates: () => ({ check: vi.fn() }) }));

const electron = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcHandlers = new Map<string, (...args: never[]) => unknown>();
  const state: Record<string, unknown> = {
    appHandlers,
    ipcHandlers,
    windows: [],
    getAllWindows: vi.fn(() => state.windows),
    getFocusedWindow: vi.fn(() => null),
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    exit: vi.fn(),
    appOn: vi.fn((event: string, listener: (...args: unknown[]) => void) => appHandlers.set(event, listener)),
    setAboutPanelOptions: vi.fn(),
    getVersion: vi.fn(() => '1.2.3'),
    getPath: vi.fn(() => '/tmp/fuse-user-data'),
    setIcon: vi.fn(),
    showErrorBox: vi.fn(),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    openExternal: vi.fn(),
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
    setApplicationMenu: vi.fn(),
    setCookie: vi.fn().mockResolvedValue(undefined),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    ipcHandle: vi.fn((channel: string, listener: (...args: never[]) => unknown) => ipcHandlers.set(channel, listener)),
  };
  state.whenReady = vi.fn(() => ({
    then: vi.fn((listener: () => Promise<void>) => {
      state.ready = listener;
      return Promise.resolve();
    }),
  }));
  state.makeWindow = vi.fn();
  state.BrowserWindow = vi.fn(function BrowserWindow(options: unknown) {
    return (state.makeWindow as any)(options);
  });
  return state as any;
});

const deps = vi.hoisted(() => {
  const settingsValue = {
    theme: 'system',
    notifications: { completed: false, failed: true, permission: true, sound: true },
    textSize: 'default',
    claudePath: '/bin/claude',
    codexPath: '/bin/codex',
    agentDefaults: {},
    displayName: '',
    aiCommitMessages: false,
    lastRoute: '/dashboard',
  };
  const settings = {
    get: vi.fn(() => settingsValue),
    update: vi.fn((patch: Record<string, unknown>) => ({ ...settingsValue, ...patch })),
  };
  const registry = {
    flushSync: vi.fn(),
    listRepositories: vi.fn(() => [{ id: 7, name: 'Repo', path: '/repos/repo' }]),
    listBlueprints: vi.fn(() => [{ project_subdir: 'project' }]),
    getConversation: vi.fn((id: string) => id === 'conversation' ? { title: 'Proof chat', repository_id: 7, blueprint_id: 'bp one' } : null),
    getRepositoryById: vi.fn(() => ({ owner: 'Numina Math', name: 'Repo' })),
  };
  const windowState = { load: vi.fn(() => ({ bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: true })), track: vi.fn() };
  return {
    settingsValue,
    settings,
    registry,
    windowState,
    detectProviders: vi.fn().mockResolvedValue([{ id: 'claude' }]),
    AttentionTracker: vi.fn(function AttentionTracker(...args: unknown[]) { return { args }; }),
    exportLocalData: vi.fn(() => ({ path: '/tmp/export.json', fileCount: 2 })),
    readStorageUsage: vi.fn((roots: unknown) => ({ roots })),
    createStorageUsageReader: vi.fn(),
    elanHome: vi.fn(() => '/elan'),
    workspaceExecutionContext: vi.fn(() => ({ projectRoot: '/repos/repo/project' })),
    buildApplicationMenu: vi.fn(() => ({ kind: 'menu' })),
    installContextMenu: vi.fn(),
    appPaths: vi.fn(() => ({ root: '/tmp/fuse-user-data' })),
    startLocalServer: vi.fn(),
    SseRooms: vi.fn(function SseRooms(this: { factory: unknown }, factory: unknown) { this.factory = factory; }),
    SettingsStore: vi.fn(function SettingsStore() { return settings; }),
    extendPathFromLoginShell: vi.fn().mockResolvedValue(undefined),
    Registry: vi.fn(function Registry() { return registry; }),
    WindowStateStore: vi.fn(function WindowStateStore() { return windowState; }),
    navigatePage: vi.fn(() => true),
    pageNavigationState: vi.fn(() => ({ canGoBack: true, canGoForward: false, swipeEnabled: true })),
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    name: 'Fuse',
    requestSingleInstanceLock: electron.requestSingleInstanceLock,
    quit: electron.quit,
    exit: electron.exit,
    on: electron.appOn,
    whenReady: electron.whenReady,
    setAboutPanelOptions: electron.setAboutPanelOptions,
    getVersion: electron.getVersion,
    getPath: electron.getPath,
    dock: { setIcon: electron.setIcon },
  },
  BrowserWindow: Object.assign(electron.BrowserWindow, {
    getAllWindows: electron.getAllWindows,
    getFocusedWindow: electron.getFocusedWindow,
  }),
  dialog: {
    showErrorBox: electron.showErrorBox,
    showSaveDialog: electron.showSaveDialog,
    showOpenDialog: electron.showOpenDialog,
  },
  ipcMain: { handle: electron.ipcHandle },
  Menu: { setApplicationMenu: electron.setApplicationMenu },
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  screen: { getAllDisplays: vi.fn(() => []) },
  session: {
    defaultSession: {
      cookies: { set: electron.setCookie },
      setPermissionRequestHandler: electron.setPermissionRequestHandler,
      setPermissionCheckHandler: electron.setPermissionCheckHandler,
    },
  },
  shell: {
    openExternal: electron.openExternal,
    openPath: electron.openPath,
    showItemInFolder: electron.showItemInFolder,
  },
  systemPreferences: { isSwipeTrackingFromScrollEventsEnabled: vi.fn(() => true) },
}));
vi.mock('@main/agents/detect', () => ({ detectProviders: deps.detectProviders }));
vi.mock('@main/attention', () => ({ AttentionTracker: deps.AttentionTracker }));
vi.mock('@main/data-export', () => ({ exportLocalData: deps.exportLocalData }));
vi.mock('@main/storage-usage', () => ({ createStorageUsageReader: deps.createStorageUsageReader }));
vi.mock('@main/services/lean/process', () => ({ elanHome: deps.elanHome }));
vi.mock('@main/services/lean/paths', () => ({ workspaceExecutionContext: deps.workspaceExecutionContext }));
vi.mock('@main/menu', () => ({ buildApplicationMenu: deps.buildApplicationMenu, installContextMenu: deps.installContextMenu }));
vi.mock('@main/paths', () => ({ appPaths: deps.appPaths }));
vi.mock('@main/server/app', () => ({ SESSION_COOKIE: 'fuse-session', startLocalServer: deps.startLocalServer }));
vi.mock('@main/server/sse', () => ({ SseRooms: deps.SseRooms }));
vi.mock('@main/settings', () => ({ SettingsStore: deps.SettingsStore }));
vi.mock('@main/shell-path', () => ({ extendPathFromLoginShell: deps.extendPathFromLoginShell }));
vi.mock('@main/store/registry', () => ({ Registry: deps.Registry }));
vi.mock('@main/window-state', () => ({ WindowStateStore: deps.WindowStateStore }));
vi.mock('@main/navigation', () => ({ navigatePage: deps.navigatePage, pageNavigationState: deps.pageNavigationState }));

function makeWindow() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const onceHandlers = new Map<string, (...args: any[]) => void>();
  const webHandlers = new Map<string, (...args: any[]) => void>();
  const webOnceHandlers = new Map<string, (...args: any[]) => void>();
  const window = {
    handlers,
    onceHandlers,
    webHandlers,
    webOnceHandlers,
    maximize: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    once: vi.fn((event: string, listener: (...args: any[]) => void) => onceHandlers.set(event, listener)),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => handlers.set(event, listener)),
    webContents: {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn((listener: (...args: any[]) => unknown) => webHandlers.set('window-open', listener as (...args: any[]) => void)),
      on: vi.fn((event: string, listener: (...args: any[]) => void) => webHandlers.set(event, listener)),
      once: vi.fn((event: string, listener: (...args: any[]) => void) => webOnceHandlers.set(event, listener)),
      capturePage: vi.fn(),
    },
  };
  return window;
}

describe('Electron main bootstrap', () => {
  const server = {
    baseUrl: 'http://127.0.0.1:8765',
    token: 'server-token',
    entryUrl: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const window = makeWindow();
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    delete process.env.ELECTRON_RENDERER_URL;
    delete process.env.FUSE_SCREENSHOT;
    deps.createStorageUsageReader.mockReturnValue(deps.readStorageUsage);
    deps.startLocalServer.mockResolvedValue(server);
    (electron.makeWindow as ReturnType<typeof vi.fn>).mockImplementation((options: unknown) => {
      (electron.windows as unknown[]).push(window);
      return Object.assign(window, { options });
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('@main/index');
  });

  it('initializes the backend, secure window, native integrations, and IPC lifecycle', async () => {
    expect(electron.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(electron.appHandlers.has('second-instance')).toBe(true);
    electron.appHandlers.get('second-instance')?.();
    expect(window.focus).not.toHaveBeenCalled();

    const ready = electron.ready as (() => Promise<void>);
    await ready();

    expect(deps.extendPathFromLoginShell).toHaveBeenCalledBefore(deps.startLocalServer);
    expect(deps.startLocalServer).toHaveBeenCalledWith(expect.objectContaining({ registry: deps.registry, settings: deps.settings }), {
      rendererDir: expect.stringMatching(/renderer$/),
      port: 8765,
    });
    expect(electron.setCookie).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:8765',
      name: 'fuse-session',
      value: 'server-token',
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    });
    expect(electron.setApplicationMenu).toHaveBeenCalledWith({ kind: 'menu' });
    expect(deps.installContextMenu).toHaveBeenCalledWith(window);
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:8765/dashboard');
    expect((window as unknown as { options: Record<string, unknown> }).options).toEqual(expect.objectContaining({
      minWidth: 1024,
      minHeight: 600,
      show: false,
      webPreferences: expect.objectContaining({ contextIsolation: true, nodeIntegration: false, sandbox: true }),
    }));

    window.onceHandlers.get('ready-to-show')?.();
    expect(window.show).toHaveBeenCalledOnce();

    const permissionRequest = electron.setPermissionRequestHandler.mock.calls[0][0] as (_contents: unknown, permission: string, callback: (allowed: boolean) => void) => void;
    const permissionCheck = electron.setPermissionCheckHandler.mock.calls[0][0] as (_contents: unknown, permission: string) => boolean;
    const permissionResult = vi.fn();
    permissionRequest({}, 'fullscreen', permissionResult);
    permissionRequest({}, 'camera', permissionResult);
    expect(permissionResult.mock.calls).toEqual([[true], [false]]);
    expect(permissionCheck({}, 'clipboard-sanitized-write')).toBe(true);
    expect(permissionCheck({}, 'microphone')).toBe(false);

    const openWindow = window.webHandlers.get('window-open') as unknown as (details: { url: string }) => unknown;
    expect(openWindow({ url: 'https://example.com' })).toEqual({ action: 'deny' });
    expect(electron.openExternal).toHaveBeenCalledWith('https://example.com');
    openWindow({ url: 'http://127.0.0.1:8765/guide' });
    expect(electron.openExternal).toHaveBeenCalledTimes(1);
    openWindow({ url: 'mailto:test@example.com' });
    expect(electron.openExternal).toHaveBeenCalledTimes(1);

    const preventDefault = vi.fn();
    window.webHandlers.get('will-navigate')?.({ preventDefault }, 'https://outside.test/path?token=secret');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electron.openExternal).toHaveBeenLastCalledWith('https://outside.test/path?token=secret');
    window.webHandlers.get('will-navigate')?.({ preventDefault }, 'http://127.0.0.1:8765/dashboard');
    expect(preventDefault).toHaveBeenCalledOnce();

    expect(logSpy).toHaveBeenCalledWith('[fuse] backend listening on http://127.0.0.1:8765');
    expect(electron.ipcHandlers.size).toBe(Object.keys(DESKTOP_IPC).length - 2);
    const ipc = (channel: string) => electron.ipcHandlers.get(channel) as (...args: unknown[]) => unknown;
    const sender = {};
    expect(ipc(DESKTOP_IPC.navigationState)({ sender })).toEqual({ canGoBack: true, canGoForward: false, swipeEnabled: true });
    expect(deps.pageNavigationState).toHaveBeenCalledWith(sender, process.platform === 'darwin');
    expect(ipc(DESKTOP_IPC.navigationGo)({ sender }, -1)).toBe(true);
    expect(deps.navigatePage).toHaveBeenCalledWith(sender, -1);
    await expect(ipc(DESKTOP_IPC.providersDetect)()).resolves.toEqual([{ id: 'claude' }]);
    expect(deps.detectProviders).toHaveBeenCalledWith({ claudePath: '/bin/claude', codexPath: '/bin/codex' });
    expect(ipc(DESKTOP_IPC.settingsGet)()).toBe(deps.settingsValue);
    expect(ipc(DESKTOP_IPC.settingsUpdate)({}, { theme: 'dark' })).toEqual(expect.objectContaining({ theme: 'dark' }));
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.settingsChanged, expect.objectContaining({ theme: 'dark' }));
    expect(ipc(DESKTOP_IPC.storageInfo)()).toEqual({ path: '/tmp/fuse-user-data' });
    expect(ipc(DESKTOP_IPC.storageUsage)()).toEqual(expect.objectContaining({ roots: expect.any(Array) }));
    expect(deps.readStorageUsage).toHaveBeenCalledWith([
      { id: 'fuse', label: 'Fuse app data', path: '/tmp/fuse-user-data', kind: 'fuse' },
      { id: 'elan', label: 'Lean toolchains & Elan data', path: '/elan', kind: 'lean' },
      expect.objectContaining({ id: 'mathlib-cache', kind: 'lean' }),
      { id: 'repo-7:project', label: 'Repo / project', path: '/repos/repo/project/.lake', kind: 'repository' },
    ]);
    await expect(ipc(DESKTOP_IPC.storageOpen)()).resolves.toBeUndefined();
    expect(electron.openPath).toHaveBeenCalledWith('/tmp/fuse-user-data');

    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/export.json' });
    await expect(ipc(DESKTOP_IPC.storageExport)()).resolves.toEqual({ path: '/tmp/export.json', fileCount: 2 });
    expect(deps.exportLocalData).toHaveBeenCalledWith('/tmp/fuse-user-data', deps.settingsValue, '/tmp/export.json');
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/repos/new'] });
    await expect(ipc(DESKTOP_IPC.dialogPickFolder)()).resolves.toBe('/repos/new');
    await ipc(DESKTOP_IPC.shellOpenExternal)({}, 'javascript:alert(1)');
    expect(electron.openExternal).not.toHaveBeenCalledWith('javascript:alert(1)');
    await ipc(DESKTOP_IPC.shellOpenExternal)({}, 'https://safe.test');
    expect(electron.openExternal).toHaveBeenCalledWith('https://safe.test');
    ipc(DESKTOP_IPC.shellShowInFolder)({}, '/tmp/file');
    expect(electron.showItemInFolder).toHaveBeenCalledWith('/tmp/file');
    ipc(DESKTOP_IPC.themeSet)({}, 'dark');
    expect(window.setBackgroundColor).toHaveBeenCalledWith('#fffefc');
    expect(ipc(DESKTOP_IPC.serverInfo)()).toEqual({ baseUrl: 'http://127.0.0.1:8765' });

    const attentionArgs = deps.AttentionTracker.mock.calls[0];
    expect((attentionArgs[0] as (id: string) => string)('conversation')).toBe('Proof chat');
    expect((attentionArgs[1] as (id: string) => string | null)('conversation')).toBe('/repo/Numina%20Math/Repo/blueprint/bp%20one?chat=conversation');
    expect((attentionArgs[1] as (id: string) => string | null)('missing')).toBeNull();

    window.isMinimized.mockReturnValueOnce(true);
    electron.appHandlers.get('second-instance')?.();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();

    const beforeQuitEvent = { preventDefault: vi.fn() };
    electron.appHandlers.get('before-quit')?.(beforeQuitEvent);
    expect(beforeQuitEvent.preventDefault).toHaveBeenCalledOnce();
    const windowCount = electron.BrowserWindow.mock.calls.length;
    electron.getAllWindows.mockReturnValue([]);
    electron.appHandlers.get('activate')?.();
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(windowCount);
    await vi.waitFor(() => expect(electron.quit).toHaveBeenCalledOnce());
    expect(deps.registry.flushSync).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    electron.appHandlers.get('before-quit')?.({ preventDefault: vi.fn() });
    expect(server.close).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('shutdown failed'), expect.anything());
  });
});
