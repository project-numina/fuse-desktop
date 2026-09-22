import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/desktop';
import { sanitizeRoute, SettingsStore } from '@main/settings';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fuse-settings-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sanitizeRoute', () => {
  it('keeps app-relative routes with query and hash', () => {
    expect(sanitizeRoute('/repo/o/r/blueprint/x?chat=abc#3.2')).toBe('/repo/o/r/blueprint/x?chat=abc#3.2');
    expect(sanitizeRoute('/')).toBe('/');
  });

  it('strips the session token wherever an earlier launch left it', () => {
    expect(sanitizeRoute('/?fuse_token=OLD?fuse_token=NEW')).toBe('/');
    expect(sanitizeRoute('/repo/o/r?chat=abc&fuse_token=T')).toBe('/repo/o/r?chat=abc');
    expect(sanitizeRoute('/repo/o/r/blueprint/x#3.2?fuse_token=T')).toBe('/repo/o/r/blueprint/x#3.2');
  });

  it('rejects anything that is not an app-relative path', () => {
    expect(sanitizeRoute(null)).toBeNull();
    expect(sanitizeRoute(undefined)).toBeNull();
    expect(sanitizeRoute('http://evil.example/')).toBeNull();
    expect(sanitizeRoute('//evil.example/')).toBeNull();
    expect(sanitizeRoute('relative')).toBeNull();
  });
});

describe('SettingsStore', () => {
  it('migrates old settings and persists global text size and notification preferences', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'dark' }));
    const store = new SettingsStore(file);
    expect(store.get().textSize).toBe('default');
    expect(store.get().notifications).toEqual(DEFAULT_SETTINGS.notifications);
    store.update({ textSize: 'large', notifications: { completed: true, failed: false, permission: true, sound: false } });
    expect(new SettingsStore(file).get()).toEqual(store.get());
  });

  it('normalizes malformed stored text size and notification values', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ textSize: 'huge', notifications: { sound: 'no' } }));
    const store = new SettingsStore(file);
    expect(store.get().textSize).toBe('default');
    expect(store.get().notifications).toEqual(DEFAULT_SETTINGS.notifications);
  });
  it('does not apply an obsolete editor-only size to the whole application', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ editor: { fontSize: 15, wordWrap: true } }));
    expect(new SettingsStore(file).get().textSize).toBe('default');
  });
  it('keeps saved permissions active when writing new defaults fails', () => {
    const file = join(dir, 'settings.json');
    const store = new SettingsStore(file);
    store.update({ theme: 'dark' });
    const previous = store.get();
    // A directory at the temporary-file path deterministically rejects writes.
    mkdirSync(`${file}.tmp`);
    const patch = { agentDefaults: { ...previous.agentDefaults, claude_permission_mode: 'bypassPermissions' as const } };
    expect(() => store.update(patch)).toThrow();
    expect(store.get()).toEqual(previous);
    expect(new SettingsStore(file).get()).toEqual(previous);
    rmSync(`${file}.tmp`, { recursive: true });
    expect(store.update(patch).agentDefaults.claude_permission_mode).toBe('bypassPermissions');
    expect(new SettingsStore(file).get()).toEqual(store.get());
  });

  it('writes atomically (temp + rename) and round-trips', () => {
    const file = join(dir, 'nested', 'settings.json');
    const store = new SettingsStore(file);
    store.update({ theme: 'dark', lastRoute: '/repo/o/r?fuse_token=T' });
    expect(existsSync(`${file}.tmp`)).toBe(false);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { theme: string; lastRoute: string };
    expect(parsed.theme).toBe('dark');
    expect(parsed.lastRoute).toBe('/repo/o/r');
    expect(new SettingsStore(file).get()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', lastRoute: '/repo/o/r' });
  });

  it('scrubs a token-bearing lastRoute left by an earlier build on load', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ ...DEFAULT_SETTINGS, lastRoute: '/?fuse_token=OLD?fuse_token=NEW' }));
    expect(new SettingsStore(file).get().lastRoute).toBe('/');
  });

  it('falls back to defaults for an unreadable file', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{"theme": "dar');
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });
});
