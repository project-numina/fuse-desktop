import type { RepositorySource } from '@/lib/api';

export default function ImportedReferencesFooter({
  filesError,
  sources,
  loading,
  loadFailed,
  showingReference,
  selectedSourceId,
  onOpenSource,
}: {
  filesError: unknown;
  sources: RepositorySource[];
  loading: boolean;
  loadFailed: boolean;
  showingReference: boolean;
  selectedSourceId: string;
  onOpenSource: (sourceId: string) => void;
}) {
  if (!filesError && sources.length === 0 && !loading && !loadFailed) return undefined;
  return (
    <div className="shrink-0 max-h-[35%] overflow-y-auto border-t border-border p-3 text-xs text-muted-foreground">
      {Boolean(filesError) && <p role="status">Could not load this folder. Retrying automatically…</p>}
      {(sources.length > 0 || loading || loadFailed) && (
        <details className="mt-3" open={showingReference || undefined}>
          <summary className="cursor-pointer font-medium text-foreground">
            Imported references{sources.length > 0 ? ` (${sources.length})` : ''}
          </summary>
          {loading && <p className="mt-2">Loading references…</p>}
          {loadFailed && <p className="mt-2">Could not load imported references.</p>}
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              title={source.display_name}
              className={`mt-1 block w-full truncate rounded-md px-2 py-2 text-left hover:bg-muted ${showingReference && selectedSourceId === source.id ? 'bg-muted text-primary' : ''}`}
              onClick={() => onOpenSource(source.id)}
            >
              {source.display_name}
            </button>
          ))}
        </details>
      )}
    </div>
  );
}
