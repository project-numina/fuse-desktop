import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/desktop';
import { exportLocalData, snapshotLocalData } from '@main/data-export';

let root: string;
let userData: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-export-'));
  userData = join(root, 'app');
  mkdirSync(join(userData, 'data', 'conversations'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('local data export', () => {
  it('round-trips Fuse data and current settings, excluding browser state and temporary files', async () => {
    writeFileSync(join(userData, 'data', 'conversations', 'a.json'), '{"message":"hello"}');
    writeFileSync(join(userData, 'data', 'pending.tmp'), 'partial');
    writeFileSync(join(userData, 'Cookies'), 'private credential');
    const destination = join(root, 'export.json');
    const result = await exportLocalData(userData, DEFAULT_SETTINGS, destination);
    expect(result.fileCount).toBe(2);
    const exportData = JSON.parse(readFileSync(destination, 'utf8'));
    expect(exportData).toMatchObject({ format: 'fuse-local-data', version: 1 });
    expect(exportData.files.map((file: { path: string }) => file.path)).toEqual(['settings.json', 'data/conversations/a.json']);
    expect(Buffer.from(exportData.files[1].content, 'base64').toString()).toBe('{"message":"hello"}');
    expect(JSON.parse(Buffer.from(exportData.files[0].content, 'base64').toString())).toEqual(DEFAULT_SETTINGS);
  });
  it('refuses destinations inside the live data, including symlinked parents', async () => {
    await expect(exportLocalData(userData, DEFAULT_SETTINGS, join(userData, '..export.json'))).rejects.toThrow('outside');
    symlinkSync(userData, join(root, 'alias'), 'junction');
    await expect(exportLocalData(userData, DEFAULT_SETTINGS, join(root, 'alias', 'export.json'))).rejects.toThrow('outside');
  });
  it('does not follow data symlinks or overwrite an existing export when snapshotting fails', async () => {
    writeFileSync(join(root, 'secret'), 'not Fuse data');
    symlinkSync(join(root, 'secret'), join(userData, 'data', 'linked'));
    const destination = join(root, 'export.json');
    writeFileSync(destination, 'previous export');
    expect(() => snapshotLocalData(userData, DEFAULT_SETTINGS)).toThrow('symbolic link');
    await expect(exportLocalData(userData, DEFAULT_SETTINGS, destination)).rejects.toThrow('symbolic link');
    expect(readFileSync(destination, 'utf8')).toBe('previous export');
  });
});
