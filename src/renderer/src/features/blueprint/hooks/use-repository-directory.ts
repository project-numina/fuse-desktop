import { useEffect, useState } from 'react';
import { fetchRepositoryDirectory, type RepositoryFileEntry } from '@/lib/api';

/** Refresh only the visible folder; never walk descendants or overlap requests. */
export function useRepositoryDirectory(owner: string, repo: string, blueprintId: string, directory: string, active: boolean) {
  const [files, setFiles] = useState<RepositoryFileEntry[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let inFlight = false;
    async function refresh(initial = false) {
      if (inFlight || controller.signal.aborted || (!initial && document.visibilityState === 'hidden')) return;
      inFlight = true;
      if (initial) { setLoading(true); setError(false); }
      try {
        const response = await fetchRepositoryDirectory(owner, repo, blueprintId, directory, controller.signal);
        if (controller.signal.aborted) return;
        setFiles(previous => JSON.stringify(previous) === JSON.stringify(response.files) ? previous : response.files);
        setDirectories(previous => JSON.stringify(previous) === JSON.stringify(response.directories) ? previous : response.directories);
        setError(!response.clone_ready);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh(true);
    const update = () => { void refresh(); };
    const timer = window.setInterval(update, 5000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [owner, repo, blueprintId, directory, active]);

  return { files, directories, loading, error };
}
