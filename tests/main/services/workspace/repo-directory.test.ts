import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoDirectory } from '@main/services/workspace/repo-files';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'fuse-directory-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

describe('on-demand repository directory listing', () => {
  it('reads just one level, including empty folders and an ordinary numina directory', async () => {
    await fs.mkdir(join(root, 'numina', 'deep'), { recursive: true });
    await fs.writeFile(join(root, 'numina', 'deep', 'Main.lean'), 'def x := 1');
    await fs.mkdir(join(root, 'empty'));
    await fs.writeFile(join(root, 'README.md'), '# Notes');
    await fs.writeFile(join(root, '.DS_Store'), 'metadata');
    const read = vi.spyOn(fs, 'readdir');
    const stat = vi.spyOn(fs, 'stat');
    const listing = await repoDirectory(root);
    expect(listing.directories).toEqual(['empty', 'numina']);
    expect(listing.files.map(file => file.path)).toEqual(['README.md']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(stat).not.toHaveBeenCalled();
    expect((await repoDirectory(root, 'numina')).directories).toEqual(['numina/deep']);
    expect((await repoDirectory(root, 'numina/deep')).files[0].path).toBe('numina/deep/Main.lean');
  });

  it('does not enter caches, symlink escapes, or traversal paths', async () => {
    for (const dir of ['.git', '.lake', 'node_modules']) await fs.mkdir(join(root, dir));
    expect((await repoDirectory(root)).directories).toEqual([]);
    for (const dir of ['../outside', '/tmp', '.git', '.lake', 'node_modules', 'missing']) {
      await expect(repoDirectory(root, dir)).rejects.toMatchObject({ status: 404 });
    }
    if (process.platform !== 'win32') {
      await fs.symlink(tmpdir(), join(root, 'outside'));
      expect((await repoDirectory(root)).directories).toEqual([]);
      await expect(repoDirectory(root, 'outside')).rejects.toMatchObject({ status: 404 });
    }
  });
});
