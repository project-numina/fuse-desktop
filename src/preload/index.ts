import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { DESKTOP_IPC, type AppSettings, type DesktopApi, type MenuCommand } from '@shared/desktop';

// Menu commands and notification clicks can arrive before the React app has
// subscribed (a window created for that very command, an early shortcut).
// Buffer them here, where a listener exists from the first moment of the
// page, and replay them to the first subscriber.
const commandListeners = new Set<(command: MenuCommand) => void>();
const pendingCommands: MenuCommand[] = [];
ipcRenderer.on(DESKTOP_IPC.menuCommand, (_event: Electron.IpcRendererEvent, command: MenuCommand) => {
  if (commandListeners.size === 0) {
    pendingCommands.push(command);
    return;
  }
  for (const listener of commandListeners) listener(command);
});

const api: DesktopApi = {
  navigation: {
    state: () => ipcRenderer.invoke(DESKTOP_IPC.navigationState),
    go: offset => ipcRenderer.invoke(DESKTOP_IPC.navigationGo, offset),
  },
  providers: {
    detect: () => ipcRenderer.invoke(DESKTOP_IPC.providersDetect),
  },
  settings: {
    get: () => ipcRenderer.invoke(DESKTOP_IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(DESKTOP_IPC.settingsUpdate, patch),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => listener(settings);
      ipcRenderer.on(DESKTOP_IPC.settingsChanged, handler);
      return () => { ipcRenderer.removeListener(DESKTOP_IPC.settingsChanged, handler); };
    },
  },
  storage: {
    info: () => ipcRenderer.invoke(DESKTOP_IPC.storageInfo),
    usage: () => ipcRenderer.invoke(DESKTOP_IPC.storageUsage),
    open: () => ipcRenderer.invoke(DESKTOP_IPC.storageOpen),
    export: () => ipcRenderer.invoke(DESKTOP_IPC.storageExport),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke(DESKTOP_IPC.dialogPickFolder),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(DESKTOP_IPC.shellOpenExternal, url),
    showInFolder: (path: string) => ipcRenderer.invoke(DESKTOP_IPC.shellShowInFolder, path),
  },
  theme: {
    set: (theme) => ipcRenderer.invoke(DESKTOP_IPC.themeSet, theme),
  },
  menu: {
    onCommand: (listener) => {
      commandListeners.add(listener);
      for (const command of pendingCommands.splice(0)) listener(command);
      return () => {
        commandListeners.delete(listener);
      };
    },
  },
  server: {
    info: () => ipcRenderer.invoke(DESKTOP_IPC.serverInfo),
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('fuse', api);
