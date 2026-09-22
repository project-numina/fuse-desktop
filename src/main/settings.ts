import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_AGENT_DEFAULTS, DEFAULT_SETTINGS, DEFAULT_NOTIFICATIONS, normalizeTextSize, type AppSettings } from '@shared/desktop';

function booleanPreferences<T extends object>(defaults: T, value: Partial<T> | undefined): T {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const next = value?.[key as keyof T];
    return [key, typeof next === 'boolean' ? next : fallback];
  })) as T;
}

/** Query parameter the loopback server exchanges for the session cookie; never persisted. */
const TOKEN_QUERY = 'fuse_token';

/**
 * Normalise a route before it is remembered as `lastRoute`: only app-relative
 * paths are restorable, and the per-launch session token must not survive in
 * the query (it would be replayed, stale, on the next launch).
 */
export function sanitizeRoute(route: string | null | undefined): string | null {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return null;
  const url = new URL(route, 'http://local.invalid');
  url.searchParams.delete(TOKEN_QUERY);
  // Earlier builds appended the token after the fragment; scrub that form too.
  const hash = url.hash.replace(new RegExp(`[?&]${TOKEN_QUERY}=[^&#]*`, 'g'), '');
  return `${url.pathname}${url.search}${hash}`;
}

export class SettingsStore {
  private value: AppSettings;

  constructor(private readonly file: string) {
    this.value = this.load();
  }

  get(): AppSettings {
    return this.value;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = {
      ...this.value,
      ...patch,
      agentDefaults: { ...this.value.agentDefaults, ...(patch.agentDefaults ?? {}) },
      notifications: booleanPreferences(DEFAULT_NOTIFICATIONS, { ...this.value.notifications, ...patch.notifications }),
      textSize: normalizeTextSize(patch.textSize ?? this.value.textSize),
      lastRoute: sanitizeRoute('lastRoute' in patch ? patch.lastRoute : this.value.lastRoute),
    };
    // A failed disk write must not activate settings the UI reports as unsaved,
    // especially permission defaults used when creating a workspace.
    this.save(next);
    this.value = next;
    return this.value;
  }

  private load(): AppSettings {
    if (!existsSync(this.file)) return DEFAULT_SETTINGS;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, ...(parsed.agentDefaults ?? {}) },
        notifications: booleanPreferences(DEFAULT_NOTIFICATIONS, parsed.notifications),
        textSize: normalizeTextSize(parsed.textSize),
        lastRoute: sanitizeRoute(parsed.lastRoute),
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  /** Temp file + rename, so a crash mid-write cannot leave a truncated file that `load` would discard. */
  private save(value: AppSettings): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2));
    renameSync(temporary, this.file);
  }
}
