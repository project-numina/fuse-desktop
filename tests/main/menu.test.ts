import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_IPC } from '@shared/desktop';

const electron = vi.hoisted(() => ({
  app: { name: 'Fuse', isPackaged: true },
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn(),
  buildFromTemplate: vi.fn(),
  openExternal: vi.fn(),
  clipboardWriteText: vi.fn(),
}));

const navigatePage = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: {
    getFocusedWindow: electron.getFocusedWindow,
    getAllWindows: electron.getAllWindows,
  },
  Menu: { buildFromTemplate: electron.buildFromTemplate },
  shell: { openExternal: electron.openExternal },
  clipboard: { writeText: electron.clipboardWriteText },
}));
vi.mock('@main/navigation', () => ({ navigatePage }));

import { buildApplicationMenu, focusAppWindow, installContextMenu, sendMenuCommand } from '@main/menu';

function fakeWindow(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const onceHandlers = new Map<string, (...args: unknown[]) => void>();
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: vi.fn(),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => onceHandlers.set(event, listener)),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => handlers.set(event, listener)),
      replaceMisspelling: vi.fn(),
      session: { addWordToSpellCheckerDictionary: vi.fn() },
    },
    handlers,
    onceHandlers,
    ...overrides,
  };
}

describe('native menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electron.getFocusedWindow.mockReturnValue(null);
    electron.getAllWindows.mockReturnValue([]);
    electron.buildFromTemplate.mockImplementation((template) => ({ template, popup: vi.fn() }));
  });

  it('restores and focuses an existing window', () => {
    const window = fakeWindow({ isMinimized: vi.fn(() => true) });
    electron.getFocusedWindow.mockReturnValue(window);

    expect(focusAppWindow(vi.fn())).toEqual({ window, created: false });
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('creates a window only when no usable window exists', () => {
    const destroyed = fakeWindow({ isDestroyed: vi.fn(() => true) });
    const created = fakeWindow();
    const ensureWindow = vi.fn(() => created);
    electron.getAllWindows.mockReturnValue([destroyed]);

    expect(focusAppWindow(ensureWindow as never)).toEqual({ window: created, created: true });
    expect(ensureWindow).toHaveBeenCalledOnce();
  });

  it('sends immediately to an existing window and waits for a new page to load', () => {
    const existing = fakeWindow();
    electron.getFocusedWindow.mockReturnValue(existing);
    sendMenuCommand('settings', vi.fn());
    expect(existing.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.menuCommand, 'settings');

    electron.getFocusedWindow.mockReturnValue(null);
    const created = fakeWindow();
    sendMenuCommand('new-workspace', () => created as never);
    expect(created.webContents.send).not.toHaveBeenCalled();
    created.onceHandlers.get('did-finish-load')?.();
    expect(created.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.menuCommand, 'new-workspace');

    const closed = fakeWindow({ isDestroyed: vi.fn(() => true) });
    sendMenuCommand('go-home', () => closed as never);
    closed.onceHandlers.get('did-finish-load')?.();
    expect(closed.webContents.send).not.toHaveBeenCalled();
  });

  it('builds working application commands, history actions, and help links', () => {
    const focused = fakeWindow();
    electron.getFocusedWindow.mockReturnValue(focused);
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const menu = buildApplicationMenu(() => focused as never, checkForUpdates) as unknown as { template: Array<{ label?: string; role?: string; submenu?: Array<{ label?: string; click?: () => void }> }> };
    const section = (label: string) => menu.template.find((item) => item.label === label || item.role === label.toLowerCase())?.submenu ?? [];

    section('File').find((item) => item.label === 'New Workspace')?.click?.();
    expect(focused.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.menuCommand, 'new-workspace');

    section('Go').find((item) => item.label === 'Back')?.click?.();
    expect(navigatePage).toHaveBeenCalledWith(focused.webContents, -1);

    section('Help').find((item) => item.label === 'Guide')?.click?.();
    section('Help').find((item) => item.label === 'Check for Updates…')?.click?.();
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(focused.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.menuCommand, { kind: 'navigate', path: '/guide' });
    section('Help').find((item) => item.label === 'Codex Documentation')?.click?.();
    expect(electron.openExternal).toHaveBeenCalledWith('https://github.com/openai/codex');
  });

  it('offers spelling, editing, selection, and link context actions', async () => {
    const window = fakeWindow();
    installContextMenu(window as never);
    const listener = window.handlers.get('context-menu');
    listener?.({}, {
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'tech'],
      isEditable: true,
      selectionText: 'selected',
      linkURL: 'https://example.com',
    });

    const built = electron.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{ label?: string; click?: () => void }>;
    built.find((item) => item.label === 'the')?.click?.();
    expect(window.webContents.replaceMisspelling).toHaveBeenCalledWith('the');
    built.find((item) => item.label?.startsWith('Add '))?.click?.();
    expect(window.webContents.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('teh');
    built.find((item) => item.label === 'Open Link in Browser')?.click?.();
    expect(electron.openExternal).toHaveBeenCalledWith('https://example.com');
    built.find((item) => item.label === 'Copy Link')?.click?.();
    await vi.waitFor(() => expect(electron.clipboardWriteText).toHaveBeenCalledWith('https://example.com'));

    listener?.({}, { misspelledWord: '', dictionarySuggestions: [], isEditable: false, selectionText: '', linkURL: '' });
    expect(electron.buildFromTemplate).toHaveBeenCalledTimes(1);
  });
});
