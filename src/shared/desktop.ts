/**
 * The small desktop-only bridge exposed on `window.fuse` by the preload
 * script. Everything the web app already does over HTTP keeps using the
 * loopback backend; this surface only covers native concerns: folder
 * pickers, revealing paths, the application menu, theme, and CLI detection.
 */

import type { ClaudePermissionMode, CodexSandboxMode, EffortLevel, ProviderId } from './agent-events';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  command: string;
  available: boolean;
  version: string | null;
  path: string | null;
  error: string | null;
}

export interface AgentDefaults {
  provider: ProviderId;
  model: string;
  effort: EffortLevel | null;
  claude_permission_mode: ClaudePermissionMode;
  codex_sandbox: CodexSandboxMode;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface NotificationPreferences {
  completed: boolean;
  failed: boolean;
  permission: boolean;
  sound: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = { completed: false, failed: true, permission: true, sound: true };
export const TEXT_SCALES = { small: 0.875, default: 1, large: 1.125, 'extra-large': 1.25 } as const;
export type TextSize = keyof typeof TEXT_SCALES;
export function normalizeTextSize(value: unknown): TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SCALES, value) ? value as TextSize : 'default';
}

export interface AppSettings {
  theme: ThemePreference;
  notifications: NotificationPreferences;
  textSize: TextSize;
  /** Overrides for where the CLIs live, when they are not on PATH. */
  claudePath: string;
  codexPath: string;
  /** Defaults applied to newly created workspaces. */
  agentDefaults: AgentDefaults;
  /** Legacy local profile name. Git actions use the repository identity. */
  displayName: string;
  /** Legacy persisted field; ignored. Fuse no longer invokes a CLI for commit messages. */
  aiCommitMessages: boolean;
  /** Path of the last opened workspace route, restored on launch. */
  lastRoute: string | null;
}

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  provider: 'claude',
  model: '',
  effort: null,
  claude_permission_mode: 'acceptEdits',
  codex_sandbox: 'workspace-write',
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  notifications: DEFAULT_NOTIFICATIONS,
  textSize: 'default',
  claudePath: '',
  codexPath: '',
  agentDefaults: DEFAULT_AGENT_DEFAULTS,
  displayName: '',
  aiCommitMessages: false,
  lastRoute: null,
};

/** Commands the native menu, shortcuts and notifications send to the UI. */
export type MenuCommand =
  | 'new-workspace'
  | 'open-repository'
  | 'settings'
  | 'focus-composer'
  | 'stop-turn'
  | 'toggle-theme'
  | 'go-home'
  | 'go-chats'
  | 'go-sessions'
  | { kind: 'navigate'; path: string };

export const DESKTOP_IPC = {
  providersDetect: 'providers:detect',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  storageInfo: 'storage:info',
  storageUsage: 'storage:usage',
  storageOpen: 'storage:open',
  storageExport: 'storage:export',
  navigationState: 'navigation:state',
  navigationGo: 'navigation:go',
  dialogPickFolder: 'dialog:pick-folder',
  shellOpenExternal: 'shell:open-external',
  shellShowInFolder: 'shell:show-in-folder',
  themeSet: 'theme:set',
  serverInfo: 'server:info',
  /** Push channel: main → renderer. Payload is `MenuCommand`. */
  menuCommand: 'menu:command',
} as const;

export interface StorageLocation {
  path: string;
  bytes: number;
}

export interface StorageUsageEntry extends StorageLocation {
  id: string;
  label: string;
  kind: 'fuse' | 'repository' | 'lean';
  status: 'complete' | 'partial' | 'missing';
  countedIn?: string;
  skippedLinks: number;
  skippedFiles: number;
  lakeBytes: number;
  oleanBytes: number;
  lakeFolders: StorageLocation[];
  oleanFolders: StorageLocation[];
}

export interface StorageUsage {
  entries: StorageUsageEntry[];
  fuseBytes: number;
  sharedBytes: number;
  measuredAt: string;
}

export interface PageNavigationState {
  swipeEnabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface DesktopApi {
  navigation: {
    state(): Promise<PageNavigationState>;
    go(offset: -1 | 1): Promise<boolean>;
  };
  providers: { detect(): Promise<ProviderInfo[]> };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(listener: (settings: AppSettings) => void): () => void;
  };
  storage: {
    info(): Promise<{ path: string }>;
    usage(): Promise<StorageUsage>;
    open(): Promise<void>;
    export(): Promise<{ path: string; fileCount: number } | null>;
  };
  dialog: {
    /** Native folder picker; resolves to the absolute path or null. */
    pickFolder(): Promise<string | null>;
    /** Absolute path of a File dropped onto the window. */
    pathForFile(file: File): string;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    showInFolder(path: string): Promise<void>;
  };
  theme: { set(theme: ThemePreference): Promise<void> };
  menu: { onCommand(listener: (command: MenuCommand) => void): () => void };
  server: { info(): Promise<{ baseUrl: string }> };
  platform: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';
}
