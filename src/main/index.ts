import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, session, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESKTOP_IPC, type AppSettings, type ThemePreference } from '@shared/desktop';
import { detectProviders } from './agents/detect';
import { AttentionTracker } from './attention';
import { exportLocalData } from './data-export';
import { createStorageUsageReader, type StorageRoot } from './storage-usage';
import { elanHome } from './services/lean/process';
import { workspaceExecutionContext } from './services/lean/paths';
import { buildApplicationMenu, installContextMenu } from './menu';
import { appPaths } from './paths';
import { SESSION_COOKIE, startLocalServer, type LocalServer } from './server/app';
import type { AppContext } from './server/context';
import { SseRooms } from './server/sse';
import { SettingsStore } from './settings';
import { extendPathFromLoginShell } from './shell-path';
import { Registry } from './store/registry';
import { WindowStateStore } from './window-state';
import { navigatePage, pageNavigationState } from './navigation';
import { startUpdates } from './updates';

// The main bundle is ESM, so there is no `__dirname`; derive it from the module URL.
const bundleDir = fileURLToPath(new URL('.', import.meta.url));

const isDev = !app.isPackaged;
const DARK_BG = '#13151a';
const LIGHT_BG = '#fffefc';
/** Fixed port in development so Vite's `/api` proxy can find the backend. */
const DEV_API_PORT = Number(process.env.FUSE_API_PORT ?? 8765);
/**
 * In development electron-vite serves the renderer from Vite (whatever port
 * it managed to bind) and proxies `/api` to the loopback backend; otherwise
 * the backend serves the built renderer itself.
 */
const rendererDevUrl = isDev && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
/** Upper bound for ending sessions, stopping Lean and closing the server before the app exits. */
const QUIT_TIMEOUT_MS = 8000;
/** Web permissions the renderer may hold; everything else a page asks for is denied. */
const ALLOWED_PERMISSIONS = new Set<string>(['clipboard-sanitized-write', 'fullscreen']);

let mainWindow: BrowserWindow | null = null;
let settings: SettingsStore;
let registry: Registry;
let attention: AttentionTracker;
let windowState: WindowStateStore;
let server: LocalServer | null = null;
let ctx: AppContext;
let quitting = false;

// A second launch (Dock click, `open -a`, taskbar) focuses the running
// window instead of starting a second app that would fight over data files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

/** Origin the window loads the app from. */
function appOrigin(): string {
  if (rendererDevUrl) return new URL(rendererDevUrl).origin;
  return server ? new URL(server.baseUrl).origin : '';
}

/** Whether a navigation stays inside the app (loopback backend or the Vite dev server). */
function isAppUrl(url: string): boolean {
  try {
    const origin = new URL(url).origin;
    return (server !== null && origin === new URL(server.baseUrl).origin) || (rendererDevUrl !== null && origin === new URL(rendererDevUrl).origin);
  } catch {
    return false;
  }
}

/** Hand a web link to the default browser; any other scheme is dropped. */
function openOutside(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

/** A URL fit for logs: the query may carry a token. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url.split('?')[0];
  }
}

function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(bundleDir, '../../resources');
}

/**
 * Authenticate the renderer's origin up front: the session cookie is set from
 * here, so the window loads the plain route and neither the token-in-query
 * exchange (which the Vite dev server would swallow, and which a `#fragment`
 * in the restored route would hide) nor a token in any URL is needed.
 */
async function installSessionCookie(): Promise<void> {
  if (!server) return;
  try {
    await session.defaultSession.cookies.set({
      url: appOrigin(),
      name: SESSION_COOKIE,
      value: server.token,
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    });
  } catch (error) {
    // The window still opens (and shows the API failures) rather than nothing at all.
    console.error('[fuse] could not set the session cookie:', error);
  }
}

function installPermissionPolicy(): void {
  const allowed = (permission: string): boolean => ALLOWED_PERMISSIONS.has(permission);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => allowed(permission));
}

function createWindow(): BrowserWindow {
  const state = windowState.load(screen);
  const window = new BrowserWindow({
    ...state.bounds,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    title: 'Fuse',
    titleBarStyle: 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG,
    webPreferences: {
      preload: join(bundleDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow = window;
  if (state.maximized) window.maximize();
  windowState.track(window);
  installContextMenu(window);

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  // Links open in the default browser; the window itself never navigates
  // away from the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) openOutside(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openOutside(url);
  });

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Renderer failed to load ${redactUrl(url)}: ${code} ${description}`);
  });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.error(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process gone: ${details.reason}`);
  });

  // The route is app-relative (SettingsStore sanitises it) and the session
  // cookie is already in place, so the plain URL is enough in both modes.
  const lastRoute = settings.get().lastRoute ?? '/';
  const origin = appOrigin();
  if (origin) void window.loadURL(`${origin}${lastRoute}`);

  // Smoke-test hook: `FUSE_SCREENSHOT=/tmp/fuse.png npm run preview` renders
  // the window, writes a PNG of it, and quits.
  const screenshotPath = process.env.FUSE_SCREENSHOT;
  if (screenshotPath) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          window.show();
          const image = await window.webContents.capturePage();
          writeFileSync(screenshotPath, image.toPNG());
        } finally {
          app.quit();
        }
      }, Number(process.env.FUSE_SCREENSHOT_DELAY_MS ?? 2500));
    });
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_IPC.navigationState, event => pageNavigationState(event.sender,
    process.platform === 'darwin' && systemPreferences.isSwipeTrackingFromScrollEventsEnabled()));
  ipcMain.handle(DESKTOP_IPC.navigationGo, (event, offset: number) => navigatePage(event.sender, offset));
  ipcMain.handle(DESKTOP_IPC.providersDetect, async () => {
    const { claudePath, codexPath } = settings.get();
    return detectProviders({ claudePath, codexPath });
  });
  ipcMain.handle(DESKTOP_IPC.settingsGet, () => settings.get());
  ipcMain.handle(DESKTOP_IPC.settingsUpdate, (_event, patch: Partial<AppSettings>) => {
    const saved = settings.update(patch);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.settingsChanged, saved);
    }
    return saved;
  });
  ipcMain.handle(DESKTOP_IPC.storageInfo, () => ({ path: app.getPath('userData') }));
  const readStorageUsage = createStorageUsageReader();
  ipcMain.handle(DESKTOP_IPC.storageUsage, () => {
    const roots: StorageRoot[] = [
      { id: 'fuse', label: 'Fuse app data', path: app.getPath('userData'), kind: 'fuse' },
      { id: 'elan', label: 'Lean toolchains & Elan data', path: elanHome(), kind: 'lean' },
      { id: 'mathlib-cache', label: 'Mathlib download cache', path: process.env.MATHLIB_CACHE_DIR?.trim() || join(process.env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache'), 'mathlib'), kind: 'lean' },
    ];
    for (const repo of registry.listRepositories()) {
      const projects = new Set(registry.listBlueprints(repo.id).map(blueprint => blueprint.project_subdir || ''));
      if (!projects.size || existsSync(join(repo.path, '.lake'))) projects.add('');
      for (const project of [...projects].sort()) {
        // Reuse the same repository-boundary checks as Lean execution.
        let projectRoot: string;
        try { projectRoot = workspaceExecutionContext(repo.path, project).projectRoot; }
        catch { continue; }
        roots.push({ id: `repo-${repo.id}:${project}`, label: project ? `${repo.name} / ${project}` : repo.name, path: join(projectRoot, '.lake'), kind: 'repository' });
      }
    }
    return readStorageUsage(roots);
  });
  ipcMain.handle(DESKTOP_IPC.storageOpen, async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error('Could not open the local data folder.');
  });
  ipcMain.handle(DESKTOP_IPC.storageExport, async () => {
    const options: Electron.SaveDialogOptions = {
      title: 'Export Fuse local data',
      defaultPath: `fuse-data-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Fuse data export', extensions: ['json'] }],
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    return exportLocalData(app.getPath('userData'), settings.get(), result.filePath);
  });
  ipcMain.handle(DESKTOP_IPC.dialogPickFolder, async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a repository folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle(DESKTOP_IPC.shellOpenExternal, async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
  ipcMain.handle(DESKTOP_IPC.shellShowInFolder, (_event, path: string) => shell.showItemInFolder(path));
  ipcMain.handle(DESKTOP_IPC.themeSet, (_event, theme: ThemePreference) => {
    nativeTheme.themeSource = theme;
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
  });
  ipcMain.handle(DESKTOP_IPC.serverInfo, () => ({ baseUrl: server?.baseUrl ?? '' }));
}

/**
 * End live sessions (so their CLI processes stop and transcripts close as
 * `completed`), stop the Lean servers and close the HTTP server, within a
 * bound: Electron's quit sequence waits for nothing on its own.
 */
async function shutdownServices(): Promise<void> {
  try {
    registry?.flushSync();
  } catch (error) {
    console.error('[fuse] flushing the registry failed:', error);
  }
  const shutdown = ctx?.services.shutdown as (() => Promise<void>) | undefined;
  const work = (async (): Promise<'done'> => {
    try {
      await shutdown?.();
      await server?.close();
    } catch (error) {
      console.error('[fuse] shutdown failed:', error);
    }
    return 'done';
  })();
  let timer: NodeJS.Timeout | null = null;
  const deadline = new Promise<'timeout'>((resolveDeadline) => {
    timer = setTimeout(() => resolveDeadline('timeout'), QUIT_TIMEOUT_MS);
  });
  const outcome = await Promise.race([work, deadline]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    console.error(`[fuse] services did not stop within ${QUIT_TIMEOUT_MS} ms; quitting anyway`);
    // The Lean hook runs last in the chain; its synchronous prefix signals
    // the language servers, which must not outlive the app.
    const lean = ctx?.services.lean as { shutdown?: () => Promise<void> } | undefined;
    void lean?.shutdown?.().catch(() => undefined);
  }
}

app.whenReady().then(async () => {
  // Development runs inside Electron.app, whose generic Dock icon otherwise wins.
  if (process.platform === 'darwin') app.dock?.setIcon(join(resourcesDir(), 'icon.png'));
  app.setAboutPanelOptions({
    applicationName: 'Fuse',
    applicationVersion: app.getVersion(),
    credits: 'Formalize mathematics in Lean 4 with Claude Code and Codex.',
  });
  // Before touching the CLIs: a Dock/Finder launch does not carry the
  // terminal's PATH.
  await extendPathFromLoginShell();

  const userData = app.getPath('userData');
  const paths = appPaths(userData);
  settings = new SettingsStore(join(userData, 'settings.json'));
  registry = new Registry(paths);
  windowState = new WindowStateStore(join(userData, 'window-state.json'));
  ctx = {
    paths,
    registry,
    settings,
    blueprintRooms: new SseRooms(() => ({ overflowMessage: 'Blueprint event stream fell behind. Reconnect to refresh.' })),
    sessionRooms: new SseRooms(() => ({ overflowMessage: 'Session event stream fell behind. Reconnect to refresh.' })),
    resourcesDir: resourcesDir(),
    server: null,
    services: {},
  };
  attention = new AttentionTracker(
    (id) => ctx.registry.getConversation(id)?.title ?? 'Conversation',
    (id) => {
      const row = ctx.registry.getConversation(id);
      if (!row) return null;
      const repo = ctx.registry.getRepositoryById(row.repository_id);
      if (!repo) return null;
      const base = `/repo/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
      return row.blueprint_id ? `${base}/blueprint/${encodeURIComponent(row.blueprint_id)}?chat=${id}` : base;
    },
    createWindow,
    () => settings.get().notifications,
  );
  ctx.services.attention = attention;

  const rendererDir = rendererDevUrl ? null : join(bundleDir, '../renderer');
  try {
    server = await startLocalServer(ctx, { rendererDir, port: isDev ? DEV_API_PORT : 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const hint = isDev ? `\n\nIf another Fuse (or a stale backend) is running on port ${DEV_API_PORT}, stop it or set FUSE_API_PORT.` : '';
    dialog.showErrorBox('Fuse could not start its local server', `${detail}${hint}`);
    app.exit(1);
    return;
  }
  ctx.server = { baseUrl: server.baseUrl, token: server.token };
  console.log(`[fuse] backend listening on ${server.baseUrl}`);

  installPermissionPolicy();
  await installSessionCookie();
  const updates = startUpdates();
  Menu.setApplicationMenu(buildApplicationMenu(createWindow, updates.check));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    // Dock/accessibility activation can arrive while the backend is shutting down.
    if (!quitting && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Electron quits as soon as this handler returns, so the first attempt is
// deferred until the services have stopped (bounded), then re-issued.
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // Let Electron finish processing the cancelled quit before issuing another.
  void shutdownServices().finally(() => setImmediate(() => app.quit()));
});
