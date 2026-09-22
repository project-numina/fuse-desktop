import { lstat, opendir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { StorageUsage, StorageUsageEntry } from '@shared/desktop';

export interface StorageRoot {
  id: string;
  label: string;
  path: string;
  kind: StorageUsageEntry['kind'];
}

interface ScanOptions {
  maxEntries?: number;
  maxMs?: number;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function addSize(sizes: Map<string, number>, path: string, bytes: number): void {
  sizes.set(path, (sizes.get(path) ?? 0) + bytes);
}

/** File sizes, not allocated disk blocks. No contents are read, nor child symlinks followed.
 * Runs only on demand. Bounded async IO keeps large checkouts off the UI/startup path.
 * Nested roots own their files; aliases and hard links are counted only once.
 */
export async function measureStorage(roots: readonly StorageRoot[], options: ScanOptions = {}): Promise<StorageUsage> {
  const deadline = Date.now() + (options.maxMs ?? 60_000);
  const maxEntries = options.maxEntries ?? 500_000;
  const files = new Set<string>();
  const canonical = await Promise.all(roots.map(async root => {
    try { return await realpath(root.path); } catch { return resolve(root.path); }
  }));
  const entries: StorageUsageEntry[] = [];
  for (const [index, root] of roots.entries()) {
    let visited = 0;
    const rootDeadline = Math.min(deadline, Date.now() + 15_000);
    const exhausted = () => visited >= maxEntries || Date.now() >= rootDeadline;
    const path = canonical[index];
    const row: StorageUsageEntry = {
      ...root, path, bytes: 0, status: 'complete', skippedLinks: 0, skippedFiles: 0,
      lakeBytes: 0, oleanBytes: 0, lakeFolders: [], oleanFolders: [],
    };
    entries.push(row);
    const duplicate = canonical.indexOf(path);
    if (duplicate < index) { row.countedIn = roots[duplicate].label; continue; }
    // A bad configuration must not turn a storage overview into a whole-disk scan.
    if (dirname(path) === path) { row.status = 'partial'; continue; }
    try {
      if (!(await lstat(path)).isDirectory()) { row.status = 'missing'; continue; }
    } catch (error) {
      row.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'partial';
      continue;
    }
    const reserved = new Set(canonical.filter(other => other !== path && within(path, other)));
    const lake = new Map<string, number>();
    const oleans = new Map<string, number>();
    const pending = [path];
    while (pending.length && !exhausted()) {
      const directory = pending.pop()!;
      try {
        // Streaming avoids allocating every name in unusually large directories.
        const directoryStat = await lstat(directory);
        if (directoryStat.isSymbolicLink()) { row.skippedLinks++; continue; }
        const handle = await opendir(directory);
        let batch: Promise<void>[] = [];
        try {
          for await (const child of handle) {
            if (exhausted()) { row.status = 'partial'; break; }
            visited++;
            const childPath = join(directory, child.name);
            if (reserved.has(childPath)) continue;
            if (child.isSymbolicLink()) { row.skippedLinks++; continue; }
            if (child.isDirectory()) { pending.push(childPath); continue; }
            if (!child.isFile()) continue;
            batch.push((async () => {
              try {
                const stat = await lstat(childPath);
                if (stat.isSymbolicLink()) { row.skippedLinks++; return; }
                if (!stat.isFile()) return;
                const identity = stat.ino ? `${stat.dev}:${stat.ino}` : childPath;
                if (files.has(identity)) return;
                files.add(identity);
                row.bytes += stat.size;
                const parts = relative(path, childPath).split(sep);
                const lakeIndex = parts.indexOf('.lake');
                if (root.kind === 'repository' || lakeIndex >= 0) {
                  row.lakeBytes += stat.size;
                  addSize(lake, root.kind === 'repository' ? path : join(path, ...parts.slice(0, lakeIndex + 1)), stat.size);
                }
                if (child.name.endsWith('.olean')) {
                  row.oleanBytes += stat.size;
                  let libIndex = -1;
                  for (let i = parts.length - 2; i >= 0; i--) {
                    if (parts[i] === 'lib' && parts[i + 1] === 'lean') { libIndex = i; break; }
                  }
                  const folder = libIndex >= 0 ? join(path, ...parts.slice(0, libIndex + 2)) : directory;
                  addSize(oleans, folder, stat.size);
                }
              } catch { row.skippedFiles++; row.status = 'partial'; }
            })());
            if (batch.length === 32) { await Promise.all(batch); batch = []; }
          }
        } finally { await Promise.all(batch); }
      } catch { row.skippedFiles++; row.status = 'partial'; }
    }
    if (pending.length || exhausted()) row.status = 'partial';
    const locations = (sizes: Map<string, number>) => [...sizes].sort(([a], [b]) => a.localeCompare(b)).map(([location, bytes]) => ({ path: location, bytes }));
    row.lakeFolders = locations(lake);
    row.oleanFolders = locations(oleans);
  }
  return {
    entries,
    fuseBytes: entries.filter(row => row.kind === 'fuse').reduce((sum, row) => sum + row.bytes, 0),
    sharedBytes: entries.filter(row => row.kind !== 'fuse').reduce((sum, row) => sum + row.bytes, 0),
    measuredAt: new Date().toISOString(),
  };
}

/** Coalesce window/focus requests and reuse a recent result, keyed by registered roots. */
export function createStorageUsageReader(scan = measureStorage, ttlMs = 30_000) {
  let current: { key: string; until: number; result: Promise<StorageUsage> } | undefined;
  return (roots: StorageRoot[]): Promise<StorageUsage> => {
    const key = JSON.stringify(roots);
    if (current?.key === key && Date.now() < current.until) return current.result;
    const result = scan(roots);
    const request = { key, until: Number.POSITIVE_INFINITY, result };
    current = request;
    void result.then(() => { request.until = Date.now() + ttlMs; }, () => { request.until = 0; });
    return result;
  };
}
