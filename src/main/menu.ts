import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { DESKTOP_IPC, type MenuCommand } from '@shared/desktop';
import { navigatePage } from './navigation';

const isMac = process.platform === 'darwin';

/** Creates (and starts loading) the app window; used when none exists. */
export type WindowFactory = () => BrowserWindow;

/**
 * The app window, brought to the front. On macOS the app stays alive after
 * its window is closed, so a menu command or notification click may find no
 * window at all: `ensureWindow` creates one in that case.
 */
export function focusAppWindow(ensureWindow: WindowFactory): { window: BrowserWindow; created: boolean } {
  const existing = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { window: existing, created: false };
  }
  return { window: ensureWindow(), created: true };
}

/**
 * Deliver a command to the renderer. A freshly created window cannot receive
 * IPC until its page has loaded; the preload then buffers the command until
 * the app subscribes, so nothing is dropped on the way.
 */
export function sendMenuCommand(command: MenuCommand, ensureWindow: WindowFactory): void {
  const { window, created } = focusAppWindow(ensureWindow);
  if (!created) {
    window.webContents.send(DESKTOP_IPC.menuCommand, command);
    return;
  }
  window.webContents.once('did-finish-load', () => {
    if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.menuCommand, command);
  });
}

/** The native application menu: standard roles plus Fuse's own commands. */
export function buildApplicationMenu(ensureWindow: WindowFactory, checkForUpdates?: () => Promise<void>): Menu {
  const send = (command: MenuCommand): void => sendMenuCommand(command, ensureWindow);
  const history = (offset: -1 | 1): void => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) navigatePage(window.webContents, offset);
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Workspace', accelerator: 'CmdOrCtrl+N', click: () => send('new-workspace') },
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: () => send('open-repository') },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => send('settings') } as MenuItemConstructorOptions, { type: 'separator' } as MenuItemConstructorOptions]),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' } as MenuItemConstructorOptions] : []),
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => history(-1) },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => history(1) },
        { type: 'separator' },
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('go-home') },
        { label: 'Chats', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('go-chats') },
        { label: 'Active Sessions', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('go-sessions') },
        { type: 'separator' },
        { label: 'Focus Composer', accelerator: 'CmdOrCtrl+L', click: () => send('focus-composer') },
        { label: 'Stop Turn', accelerator: 'CmdOrCtrl+.', click: () => send('stop-turn') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('toggle-theme') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'front' } as MenuItemConstructorOptions]
          : [{ role: 'close' } as MenuItemConstructorOptions]),
      ],
    },
    {
      role: 'help',
      submenu: [
        ...(checkForUpdates ? [{ label: 'Check for Updates…', click: () => { void checkForUpdates(); } }, { type: 'separator' } as MenuItemConstructorOptions] : []),
        { label: 'Guide', click: () => send({ kind: 'navigate', path: '/guide' }) },
        { type: 'separator' },
        { label: 'Claude Code Documentation', click: () => void shell.openExternal('https://docs.anthropic.com/en/docs/claude-code') },
        { label: 'Codex Documentation', click: () => void shell.openExternal('https://github.com/openai/codex') },
        { label: 'leanblueprint', click: () => void shell.openExternal('https://github.com/PatrickMassot/leanblueprint') },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * Electron has no default right-click menu. Provide the editing commands a
 * desktop user expects in inputs and on selected text, plus spelling
 * suggestions.
 */
export function installContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => window.webContents.replaceMisspelling(suggestion) });
      }
      items.push({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (params.linkURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Open Link in Browser', click: () => void shell.openExternal(params.linkURL) });
      items.push({ label: 'Copy Link', click: () => void import('electron').then(({ clipboard }) => clipboard.writeText(params.linkURL)) });
    }
    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window });
  });
}
