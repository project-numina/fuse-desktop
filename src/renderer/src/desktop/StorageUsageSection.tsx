import { useEffect, useState } from 'react';
import type { StorageLocation, StorageUsage, StorageUsageEntry } from '@shared/desktop';
import { DisclosureRow } from '@/components/ui/disclosure-row';
import { desktopApi } from './bridge';
import { storageCache } from './storage-cache';

/** Decimal units match Finder's GB; values are file sizes, not disk allocation. */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const index = Math.min(Math.floor(Math.log10(bytes) / 3), 4);
  return `${(bytes / 1000 ** index).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}

function Locations({ title, locations }: { title: string; locations: StorageLocation[] }) {
  if (!locations.length) return null;
  return <div className="mt-4">
    <h5 className="mb-2 text-xs font-medium">{title}</h5>
    <ul className="space-y-2">
      {locations.map(location => <li key={location.path} className="flex items-start justify-between gap-4 text-xs text-muted-foreground">
        <code className="min-w-0 break-all">{location.path}</code>
        <span className="shrink-0 tabular-nums">{formatStorageSize(location.bytes)}</span>
      </li>)}
    </ul>
  </div>;
}

function UsageRow({ entry }: { entry: StorageUsageEntry }) {
  const size = entry.countedIn ? `Counted in ${entry.countedIn}`
    : entry.status === 'missing' ? entry.kind === 'repository' ? 'No build data' : 'Not on disk'
      : `${entry.status === 'partial' ? 'At least ' : ''}${formatStorageSize(entry.bytes)}`;
  return <DisclosureRow title={entry.label} meta={size}>
      <code className="block break-all text-xs text-muted-foreground">{entry.path}</code>
      {!entry.countedIn && entry.status !== 'missing' && <>
        {entry.kind === 'repository' && <p className="mt-3 text-xs text-muted-foreground">
          {formatStorageSize(entry.oleanBytes)} in .olean files, included in the build/dependency total above.
        </p>}
        <Locations title="Build & dependency folders" locations={entry.lakeFolders} />
        <Locations title="Compiled Lean (.olean) locations" locations={entry.oleanFolders} />
        {entry.kind === 'repository' && !entry.oleanFolders.length && <p className="mt-3 text-xs text-muted-foreground">No .olean files {entry.status === 'partial' ? 'measured yet' : 'found'}.</p>}
        {entry.status === 'partial' && <p className="mt-3 text-xs text-muted-foreground">Incomplete estimate: some files were unavailable or the scan reached its limit.</p>}
        {entry.skippedLinks > 0 && <p className="mt-3 text-xs text-muted-foreground">{entry.skippedLinks} symbolic links excluded; linked data is counted only if its folder is listed separately.</p>}
      </>}
  </DisclosureRow>;
}

export function StorageUsageSection() {
  const storage = desktopApi()?.storage;
  const cache = storage?.usage ? storageCache(storage) : null;
  const [usage, setUsage] = useState<StorageUsage | null>(() => cache?.value ?? null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!cache) return;
    let active = true;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await cache.read();
        if (active) { setUsage(result); setError(false); }
      } catch { if (active) setError(true); }
      finally { pending = false; }
    };
    void read();
    window.addEventListener('focus', read);
    return () => { active = false; window.removeEventListener('focus', read); };
  }, [cache]);

  const partial = usage?.entries.some(entry => entry.status === 'partial');
  return <div>
    <h4 className="mb-3 text-sm font-medium">Storage used</h4>
    {!usage ? <p role="status" className="text-sm text-muted-foreground">
      {!storage?.usage ? 'Restart Fuse to measure storage.' : error ? 'Could not measure storage. Reopen Data to try again.' : 'Calculating folder sizes…'}
    </p> : <>
      <p className="text-2xl font-semibold tabular-nums">{partial ? 'At least ' : ''}{formatStorageSize(usage.fuseBytes + usage.sharedBytes)}<span className="ml-2 text-sm font-normal text-muted-foreground">measured locally</span></p>
      <dl className="my-4 grid grid-cols-2 gap-6 max-sm:grid-cols-1">
        <div><dt className="text-sm text-muted-foreground">Fuse app data</dt><dd className="mt-1 text-lg font-medium tabular-nums">{formatStorageSize(usage.fuseBytes)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Shared Lean data</dt><dd className="mt-1 text-lg font-medium tabular-nums">{formatStorageSize(usage.sharedBytes)}</dd></div>
      </dl>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">Build files and dependencies for Lean projects configured in Fuse, plus shared toolchains and download cache. Other apps use these too; uninstalling Fuse does not remove them.</p>
      <div className="space-y-8">
        {[{ label: 'Fuse', entries: usage.entries.filter(entry => entry.kind === 'fuse') },
          { label: 'Shared Lean data', entries: usage.entries.filter(entry => entry.kind !== 'fuse') }].map(group => group.entries.length > 0 && <section key={group.label}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</h4>
          <div className="border-t border-border">{group.entries.map(entry => <UsageRow key={entry.id} entry={entry} />)}</div>
        </section>)}
      </div>
      {!usage.entries.some(entry => entry.kind === 'repository') && <p className="mt-3 text-sm text-muted-foreground">No repositories open yet.</p>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Estimates use file sizes. Nested folders and hard links are counted once. Excludes source files, Git history, the app installation, agent history, and files outside the listed locations.</p>
      {error && <p role="status" className="mt-2 text-xs text-muted-foreground">Could not update sizes; showing the last measurement.</p>}
    </>}
  </div>;
}
