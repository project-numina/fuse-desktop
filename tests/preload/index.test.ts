import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DESKTOP_IPC, type AppSettings, type DesktopApi, type MenuCommand } from '@shared/desktop';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn((channel: string, ...args: unknown[]) => Promise.resolve({ channel, args })),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(() => '/tmp/example.lean'),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
  webUtils: { getPathForFile: electron.getPathForFile },
}));

describe('preload bridge', () => {
  let api: DesktopApi;
  let emitCommand: (event: unknown, command: MenuCommand) => void;

  beforeAll(async () => {
    await import('../../src/preload/index');
    api = electron.exposeInMainWorld.mock.calls[0][1] as DesktopApi;
    emitCommand = electron.on.mock.calls.find(([channel]) => channel === DESKTOP_IPC.menuCommand)?.[1] as typeof emitCommand;
  });

  it('exposes the bridge and maps request methods to their IPC channels', async () => {
    expect(electron.exposeInMainWorld).toHaveBeenCalledWith('fuse', expect.any(Object));
    await api.navigation.state();
    await api.navigation.go(-1);
    await api.providers.detect();
    await api.settings.get();
    await api.settings.update({ theme: 'dark' });
    await api.storage.info();
    await api.storage.usage();
    await api.storage.open();
    await api.storage.export();
    await api.dialog.pickFolder();
    await api.shell.openExternal('https://example.com');
    await api.shell.showInFolder('/tmp/file');
    await api.theme.set('light');
    await api.server.info();

    expect(electron.invoke.mock.calls).toEqual(expect.arrayContaining([
      [DESKTOP_IPC.navigationState],
      [DESKTOP_IPC.navigationGo, -1],
      [DESKTOP_IPC.providersDetect],
      [DESKTOP_IPC.settingsGet],
      [DESKTOP_IPC.settingsUpdate, { theme: 'dark' }],
      [DESKTOP_IPC.storageInfo],
      [DESKTOP_IPC.storageUsage],
      [DESKTOP_IPC.storageOpen],
      [DESKTOP_IPC.storageExport],
      [DESKTOP_IPC.dialogPickFolder],
      [DESKTOP_IPC.shellOpenExternal, 'https://example.com'],
      [DESKTOP_IPC.shellShowInFolder, '/tmp/file'],
      [DESKTOP_IPC.themeSet, 'light'],
      [DESKTOP_IPC.serverInfo],
    ]));
    const file = new File([''], 'example.lean');
    expect(api.dialog.pathForFile(file)).toBe('/tmp/example.lean');
    expect(electron.getPathForFile).toHaveBeenCalledWith(file);
    expect(api.platform).toBe(process.platform);
  });

  it('forwards settings changes until unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = api.settings.onChanged(listener);
    const handler = electron.on.mock.calls.find(([channel]) => channel === DESKTOP_IPC.settingsChanged)?.[1] as (event: unknown, settings: AppSettings) => void;
    const settings = { theme: 'dark' } as AppSettings;
    handler({}, settings);
    expect(listener).toHaveBeenCalledWith(settings);

    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith(DESKTOP_IPC.settingsChanged, handler);
  });

  it('buffers early menu commands, broadcasts live commands, and supports unsubscribe', () => {
    emitCommand({}, 'settings');
    emitCommand({}, { kind: 'navigate', path: '/guide' });
    const first = vi.fn();
    const unsubscribeFirst = api.menu.onCommand(first);
    expect(first.mock.calls.map(([command]) => command)).toEqual(['settings', { kind: 'navigate', path: '/guide' }]);

    const second = vi.fn();
    const unsubscribeSecond = api.menu.onCommand(second);
    emitCommand({}, 'go-home');
    expect(first).toHaveBeenLastCalledWith('go-home');
    expect(second).toHaveBeenLastCalledWith('go-home');

    unsubscribeFirst();
    emitCommand({}, 'go-chats');
    expect(first).not.toHaveBeenCalledWith('go-chats');
    expect(second).toHaveBeenLastCalledWith('go-chats');
    unsubscribeSecond();
  });
});
