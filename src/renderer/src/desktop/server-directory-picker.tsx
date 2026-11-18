import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request } from '@/lib/api/core';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
  truncated: boolean;
}

export function ServerDirectoryPicker({ onSelect }: { onSelect: (path: string | null) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [path, setPath] = useState('');
  const [location, setLocation] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const id = ++generation.current;
    const controller = new AbortController();
    setLoading(true); setError(null);
    const query = new URLSearchParams();
    if (location !== undefined) query.set('path', location);
    if (filter) query.set('filter', filter);
    void request<DirectoryListing>(`/local/directories?${query}`, { signal: controller.signal })
      .then(value => {
        if (id !== generation.current) return;
        setListing(value); setPath(value.path); setLoading(false);
      }).catch((caught: unknown) => {
        if (controller.signal.aborted || id !== generation.current) return;
        setLoading(false); setError(caught instanceof Error ? caught.message : 'Could not read this directory.');
      });
    return () => controller.abort();
  }, [location, filter, reload]);

  const browse = (next?: string) => {
    setFilter(''); setLocation(next); setReload(value => value + 1);
  };
  async function select() {
    if (!path.trim() || selecting) return;
    setSelecting(true); setError(null);
    try {
      const result = await request<{ path: string }>('/local/directories/validate', { method: 'POST', body: JSON.stringify({ path }) });
      onSelect(result.path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Choose an accessible absolute directory path.');
    } finally { setSelecting(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onSelect(null); }}>
    <DialogContent className="sm:max-w-xl" showCloseButton={false}>
      <DialogTitle>Choose a server folder</DialogTitle>
      <DialogDescription>Browse folders on the computer running Fuse. Enter an absolute path to go directly to a folder.</DialogDescription>
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); browse(path); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor="server-folder-path" className="mb-1 block text-xs font-medium">Absolute folder path</label>
          <input id="server-folder-path" className="w-full rounded border border-border bg-background px-3 py-2" value={path} onChange={event => setPath(event.target.value)} disabled={selecting} />
        </div>
        <button type="submit" className="btn-outline-accent px-3 py-2" disabled={!path.trim() || selecting}>Browse</button>
      </form>
      <div className="flex gap-2">
        <button type="button" className="btn-outline-accent px-3 py-1.5" onClick={() => browse()} disabled={selecting}>Home</button>
        <button type="button" className="btn-outline-accent px-3 py-1.5" onClick={() => browse(listing?.parent ?? undefined)} disabled={!listing?.parent || loading || selecting}>Up</button>
      </div>
      <label className="text-xs font-medium">Filter folders
        <input className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm" value={filter} onChange={event => setFilter(event.target.value)} disabled={selecting} placeholder="Search folder names" />
      </label>
      <div className="h-56 overflow-y-auto rounded border border-border" aria-busy={loading}>
        {loading ? <p role="status" className="p-3 text-muted-foreground">Loading folders…</p>
          : !error && listing?.directories.length === 0 ? <p className="p-3 text-muted-foreground">No matching folders.</p>
            : !error && <ul>{listing?.directories.slice(0, 30).map(directory => <li key={directory.path}>
              <button type="button" className="w-full break-all px-3 py-2 text-left hover:bg-muted" disabled={selecting} onClick={() => browse(directory.path)}>{directory.name}</button>
            </li>)}</ul>}
      </div>
      {listing?.truncated && !loading && <p className="text-xs text-muted-foreground">Showing the first 30 folders. Filter by name to find more.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-outline-accent px-4 py-2" onClick={() => onSelect(null)}>Cancel</button>
        <button type="button" className="btn-outline-accent px-4 py-2" disabled={!path.trim() || loading || selecting} onClick={() => void select()}>{selecting ? 'Checking…' : 'Select folder'}</button>
      </div>
    </DialogContent>
  </Dialog>;
}

let pending: Promise<string | null> | null = null;
/** This dialog selects server filesystem paths; browser File objects are unrelated. */
export function pickServerDirectory(): Promise<string | null> {
  if (pending) return pending;
  pending = new Promise(resolve => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let closed = false;
    root.render(<ServerDirectoryPicker onSelect={path => {
      if (closed) return;
      closed = true;
      resolve(path);
      queueMicrotask(() => { root.unmount(); container.remove(); pending = null; });
    }} />);
  });
  return pending;
}
