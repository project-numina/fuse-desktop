import { mkdtemp, mkdir, writeFile, rm, symlink, link, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageUsageReader, measureStorage, type StorageRoot } from '@main/storage-usage';

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'fuse-storage-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function file(path: string, bytes: number) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.alloc(bytes));
}
function target(name: string, kind: StorageRoot['kind'] = 'repository'): StorageRoot {
  return { id: name, label: name, path: join(root, name), kind };
}

describe('storage usage', () => {
  it('splits Fuse data from repositories and shared Lean tools, including nested dependency oleans', async () => {
    await file(join(root, 'app', 'settings.json'), 10);
    await file(join(root, 'repo', 'Main.lean'), 20);
    await file(join(root, 'repo', '.lake', 'build', 'lib', 'lean', 'Main.olean'), 30);
    await file(join(root, 'repo', '.lake', 'packages', 'mathlib', '.lake', 'build', 'lib', 'lean', 'Mathlib', 'Basic.olean'), 40);
    await file(join(root, 'repo', '.lake', 'build', 'bin', 'main'), 50);
    await file(join(root, 'elan', 'toolchains', 'v1', 'lib', 'lean', 'Init.olean'), 60);
    const usage = await measureStorage([target('app', 'fuse'), target('repo/.lake'), target('elan', 'lean')]);
    expect(usage.fuseBytes).toBe(10);
    expect(usage.sharedBytes).toBe(180);
    expect(usage.entries[1]).toMatchObject({ bytes: 120, lakeBytes: 120, oleanBytes: 70, status: 'complete' });
    expect(usage.entries[1].lakeFolders).toEqual([{ path: join(root, 'repo', '.lake'), bytes: 120 }]);
    expect(usage.entries[1].oleanFolders).toEqual([
      { path: join(root, 'repo', '.lake', 'build', 'lib', 'lean'), bytes: 30 },
      { path: join(root, 'repo', '.lake', 'packages', 'mathlib', '.lake', 'build', 'lib', 'lean'), bytes: 40 },
    ]);
  });

  it('assigns nested roots separately and never charges Fuse data to a parent repository', async () => {
    await file(join(root, 'repo', 'Main.lean'), 10);
    await file(join(root, 'repo', 'nested', 'Other.lean'), 20);
    await file(join(root, 'repo', 'fuse', 'settings.json'), 30);
    const usage = await measureStorage([target('repo/fuse', 'fuse'), target('repo'), target('repo/nested')]);
    expect(usage.entries.map(entry => entry.bytes)).toEqual([30, 10, 20]);
    expect(usage.sharedBytes).toBe(30);
  });

  it('counts repository aliases and hard links once without following child symlinks', async () => {
    await file(join(root, 'repo', 'Main.lean'), 10);
    await file(join(root, 'external', 'Large.olean'), 100);
    await symlink(join(root, 'repo'), join(root, 'alias'), 'junction');
    await symlink(join(root, 'external'), join(root, 'repo', 'linked'), 'junction');
    await symlink(join(root, 'repo'), join(root, 'repo', 'cycle'), 'junction');
    await link(join(root, 'repo', 'Main.lean'), join(root, 'repo', 'Copy.lean'));
    const usage = await measureStorage([target('repo'), target('alias')]);
    expect(usage.sharedBytes).toBe(10);
    expect(usage.entries[0].skippedLinks).toBe(2);
    expect(usage.entries[1]).toMatchObject({ bytes: 0, countedIn: 'repo' });
  });

  it('distinguishes unavailable folders, zero-byte folders, and bounded partial scans', async () => {
    await mkdir(join(root, 'empty'));
    await file(join(root, 'repo', 'Main.lean'), 10);
    const usage = await measureStorage([target('missing'), target('empty'), target('repo')]);
    expect(usage.entries.map(entry => entry.status)).toEqual(['missing', 'complete', 'complete']);
    const limited = await measureStorage([target('repo')], { maxEntries: 0 });
    expect(limited.entries[0]).toMatchObject({ status: 'partial', bytes: 0 });
    const timed = await measureStorage([target('repo')], { maxMs: 0 });
    expect(timed.entries[0].status).toBe('partial');
  });

  it('does not reserve similarly named sibling paths or group ordinary files as Lake output', async () => {
    await file(join(root, 'repo', 'lib', 'file.olean'), 10);
    await file(join(root, 'repo-two', '.lake', 'test.txt'), 20);
    const usage = await measureStorage([target('repo', 'lean'), target('repo-two/.lake')]);
    expect(usage.entries[0]).toMatchObject({ bytes: 10, lakeBytes: 0, oleanBytes: 10 });
    expect(usage.entries[0].oleanFolders).toEqual([{ path: join(root, 'repo', 'lib'), bytes: 10 }]);
    expect(usage.entries[1].lakeBytes).toBe(20);
  });

  it('coalesces in-flight requests, invalidates changed roots, and retries failures', async () => {
    const result = await measureStorage([]);
    const scan = vi.fn().mockResolvedValue(result);
    const read = createStorageUsageReader(scan);
    const first = read([]);
    expect(read([])).toBe(first);
    await first;
    await read([]);
    expect(scan).toHaveBeenCalledTimes(1);
    await read([target('repo')]);
    expect(scan).toHaveBeenCalledTimes(2);
    scan.mockRejectedValueOnce(new Error('unavailable'));
    await expect(read([])).rejects.toThrow('unavailable');
    await read([]);
    expect(scan).toHaveBeenCalledTimes(4);
  });
});
