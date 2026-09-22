import { Activity, Suspense, useState, type ReactNode } from 'react';

const MAX_PAGES = 3;
interface Entry { key: string; page: ReactNode }

/** Only static guides and global settings opt in. Never retain workspace/editor
 * trees, chat transcripts, or repository contents here. Hidden Activity trees
 * retain DOM/state (including scroll) but detach effects and subscriptions.
 * Least-recently-used pages are discarded; nothing is serialized to disk.
 */
export default function LightweightPageCache({ pageKey, page, fallback }: {
  pageKey: string | null;
  page: ReactNode;
  fallback: ReactNode;
}) {
  const [cache, setCache] = useState<{ current: string | null; entries: Entry[] }>({ current: null, entries: [] });
  let entries = cache.entries;
  if (cache.current !== pageKey) {
    entries = pageKey === null ? entries : [
      ...entries.filter(entry => entry.key !== pageKey),
      { key: pageKey, page },
    ].slice(-MAX_PAGES);
    setCache({ current: pageKey, entries });
  }
  return <>
    {entries.map(entry => <Activity key={entry.key} name={entry.key} mode={entry.key === pageKey ? 'visible' : 'hidden'}>
      <Suspense fallback={fallback}>{entry.key === pageKey ? page : entry.page}</Suspense>
    </Activity>)}
    {pageKey === null && <Suspense fallback={fallback}>{page}</Suspense>}
  </>;
}
