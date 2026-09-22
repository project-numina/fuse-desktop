import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchRepositorySources, type RepositorySource } from '@/lib/api';

interface AttachmentPickerProps {
  open: boolean;
  owner: string;
  repository: string;
  blueprintId: string;
  /** Authoritative page-level sources, when that list has already loaded. */
  sources?: RepositorySource[];
  selectedSourceIds: string[];
  onClose: () => void;
  onSelectSource: (source: RepositorySource) => void;
  onRequestAddSource: () => void;
}

export default function AttachmentPicker({
  open,
  owner,
  repository,
  blueprintId,
  sources: providedSources,
  selectedSourceIds,
  onClose,
  onSelectSource,
  onRequestAddSource,
}: AttachmentPickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState('');
  const [loadedSources, setLoadedSources] = useState<RepositorySource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || providedSources !== undefined) return;
    let active = true;
    setLoading(true);
    setError(null);
    void fetchRepositorySources(owner, repository, blueprintId)
      .then((response) => {
        if (active) setLoadedSources(response.sources);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load sources.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, owner, repository, blueprintId, providedSources]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, onClose]);

  const filteredSources = useMemo(() => {
    const sources = providedSources ?? loadedSources;
    const selected = new Set(selectedSourceIds);
    const query = search.trim().toLowerCase();
    return sources.filter((source) => {
      if (selected.has(source.id)) return false;
      if (!query) return true;
      return source.display_name.toLowerCase().includes(query)
        || source.source_type.toLowerCase().includes(query)
        || source.artifacts.some((artifact) => artifact.toLowerCase().includes(query));
    });
  }, [loadedSources, providedSources, search, selectedSourceIds]);

  if (!open) return null;

  return (
    <div
      ref={pickerRef}
      role="dialog"
      aria-label="Attach source"
      className="absolute bottom-[calc(100%+8px)] left-0 z-20 box-border max-h-[300px] w-full max-w-[340px] overflow-auto rounded-md border border-border bg-card p-2 shadow-lg"
    >
      <div className="mb-2 flex items-center gap-1">
        <input
          type="search"
          aria-label="Search sources"
          placeholder="Search sources"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <button
          type="button"
          aria-label="Add source"
          title="Add source"
          className="flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-muted hover:text-primary"
          onClick={onRequestAddSource}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {loading ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">Loading sources…</div>
      ) : error ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">{error}</div>
      ) : filteredSources.length ? (
        filteredSources.map((source) => (
          <button
            key={source.id}
            type="button"
            className="flex w-full cursor-pointer items-center rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:bg-muted focus-visible:outline-none"
            onClick={() => {
              onSelectSource(source);
              setSearch('');
            }}
          >
            <span className="truncate">{source.display_name}</span>
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground">No sources</div>
      )}
    </div>
  );
}
