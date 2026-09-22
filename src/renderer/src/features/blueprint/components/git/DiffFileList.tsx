import { cn } from '@/lib/utils';

/**
 * List of changed files with per-file added/deleted line counts.
 *
 * The parent owns the selection and is notified via `onSelect`. Shared by both the pending-diff
 * (Changes) and commit-detail (History) views, whose file rows expose the same
 * minimal `{ path, additions, deletions }` shape.
 */
export interface DiffFileRow {
  path: string;
  additions: number;
  deletions: number;
}

export interface DiffFileListProps {
  files: DiffFileRow[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function DiffFileList({ files, selectedPath, onSelect }: DiffFileListProps) {
  return (
    <ul className="m-0 list-none p-0">
      {files.map((file) => (
        <li
          key={file.path}
          className={cn(
            'border-b border-[var(--numina-border-light)] last:border-b-0',
            selectedPath === file.path && '[&>button]:bg-[var(--accent-overlay-soft)]',
          )}
        >
          <button
            type="button"
            className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-[var(--space-2)] border-none bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-left font-[inherit] text-[var(--text-primary)] hover:bg-[var(--numina-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--numina-accent)]"
            onClick={() => onSelect(file.path)}
          >
            <span className="break-all [font-family:var(--numina-font-mono)] text-xs text-[var(--text-body)] [overflow-wrap:anywhere]">
              {file.path}
            </span>
            <span className="inline-flex shrink-0 gap-[var(--space-1)] [font-family:var(--numina-font-mono)] text-[0.7rem]">
              {file.additions > 0 && (
                <span className="font-semibold text-[var(--status-verified-text)]">
                  +{file.additions}
                </span>
              )}
              {file.deletions > 0 && (
                <span className="font-semibold text-[var(--status-unformalized-text)]">
                  -{file.deletions}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default DiffFileList;
