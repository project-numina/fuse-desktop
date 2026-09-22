import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSettings } from '@shared/desktop';

const MAX_EXPORT_BYTES = 128 * 1024 * 1024;

/** Allowlist only Fuse-owned data, never Electron cookies, caches or CLI homes. */
export function snapshotLocalData(userData: string, settings: AppSettings) {
  const files: { path: string; encoding: 'base64'; content: string }[] = [];
  let bytes = 0;
  function add(path: string, content: Buffer) {
    bytes += content.length;
    if (bytes > MAX_EXPORT_BYTES) throw new Error('Local data is too large to export here. Use Open folder to back it up manually.');
    files.push({ path, encoding: 'base64', content: content.toString('base64') });
  }
  function visit(path: string) {
    const absolute = join(userData, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('Local data contains a symbolic link. Export stopped to avoid copying files outside Fuse.');
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (name.endsWith('.tmp') || name.endsWith('.lock')) continue;
        visit(`${path}/${name}`);
      }
    } else if (stat.isFile()) {
      if (bytes + stat.size > MAX_EXPORT_BYTES) throw new Error('Local data is too large to export here. Use Open folder to back it up manually.');
      add(path, readFileSync(absolute));
    }
  }
  add('settings.json', Buffer.from(JSON.stringify(settings, null, 2)));
  if (existsSync(join(userData, 'data'))) visit('data');
  return { format: 'fuse-local-data', version: 1, exportedAt: new Date().toISOString(), files };
}

/** Dialog-selected destination only. Atomic write leaves existing exports intact on failure. */
export async function exportLocalData(userData: string, settings: AppSettings, destination: string) {
  const target = join(realpathSync(dirname(resolve(destination))), basename(destination));
  const inside = relative(realpathSync(userData), target);
  if (!inside || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
    throw new Error('Choose a destination outside Fuse’s data folder.');
  }
  // Snapshot synchronously so writes on this main-process event loop cannot
  // interleave between the indexes and their records. No repository is walked.
  const snapshot = snapshotLocalData(userData, settings);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { path: target, fileCount: snapshot.files.length };
}
