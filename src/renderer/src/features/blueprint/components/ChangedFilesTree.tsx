import { Fragment, type KeyboardEvent, type ReactNode } from 'react';

import {
  buildErrorTitle,
  diffStatsTitle,
  type Breadcrumb,
  type DirectoryEntry,
} from '@/features/blueprint/components/changed-files-tree';
import { cn } from '@/lib/utils';

function FolderIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-70"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DiagnosticIcon({ warning }: { warning: boolean }) {
  return warning ? (
    <svg className="inline-block h-3 w-3 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5L15 14H1z" fill="currentColor" />
      <path d="M8 6v4M8 11.6v.6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ) : (
    <svg className="inline-block h-3 w-3 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4v5M8 11.2v.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DiagnosticBadge({ entry }: { entry: DirectoryEntry }) {
  if (!entry.buildErrors) return null;
  const warningOnly = entry.buildErrors.errors === 0 && entry.buildErrors.warnings > 0;
  return (
    <span
      className={cn(
        'ml-[var(--space-2)] inline-flex shrink-0 items-center gap-1 text-[0.6875rem] [font-variant-numeric:tabular-nums]',
        warningOnly ? 'text-[var(--build-warning)]' : 'text-[var(--build-error)]',
      )}
      title={buildErrorTitle(entry)}
    >
      <DiagnosticIcon warning={warningOnly} />
      <span className="leading-none">
        {entry.buildErrors.errors || entry.buildErrors.warnings}
      </span>
    </span>
  );
}

function DiffBadge({ entry }: { entry: DirectoryEntry }) {
  if (!entry.diff) return null;
  return (
    <span
      className="ml-[var(--space-2)] flex shrink-0 items-baseline gap-[var(--space-1)] text-[0.6875rem] [font-variant-numeric:tabular-nums]"
      title={diffStatsTitle(entry)}
    >
      {entry.diff.added > 0 ? (
        <span className="text-[var(--status-verified-text)]">+{entry.diff.added}</span>
      ) : null}
      {entry.diff.deleted > 0 ? (
        <span className="text-[var(--build-error)]">-{entry.diff.deleted}</span>
      ) : null}
    </span>
  );
}

interface EntryRowProps {
  entry: DirectoryEntry;
  selectedFile: string | null;
  onActivate: (entry: DirectoryEntry) => void;
}

function EntryRow({ entry, selectedFile, onActivate }: EntryRowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate(entry);
  };
  return (
    <li
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'flex cursor-pointer items-center gap-[var(--space-2)] border-l-2 px-[var(--space-3)] py-[var(--space-1)] [font-family:var(--numina-font-mono)] text-xs transition-[background,border-color] hover:bg-[var(--hover-overlay)]',
        entry.kind === 'file' && selectedFile === entry.path
          ? 'border-[var(--numina-accent)] font-semibold text-[var(--numina-accent)]'
          : 'border-transparent text-[var(--text-primary)]',
      )}
      onClick={() => onActivate(entry)}
    >
      {entry.kind === 'folder' ? <FolderIcon /> : <FileIcon />}
      <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {entry.name}
      </span>
      <DiagnosticBadge entry={entry} />
      <DiffBadge entry={entry} />
    </li>
  );
}

interface BreadcrumbsProps {
  breadcrumbs: Breadcrumb[];
  onGoUp: () => void;
  onGoHome: () => void;
  onEnterFolder: (path: string) => void;
}

function Breadcrumbs({ breadcrumbs, onGoUp, onGoHome, onEnterFolder }: BreadcrumbsProps) {
  if (!breadcrumbs.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-[var(--space-1)] overflow-x-auto whitespace-nowrap border-b border-[var(--numina-border-light)] px-[var(--space-3)] py-[var(--space-2)] [font-family:var(--numina-font-mono)] text-xs text-[var(--text-muted)]">
      <button
        type="button"
        aria-label="Go up one folder"
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent p-0 text-[var(--text-muted)] hover:bg-[var(--hover-overlay-strong)] hover:text-[var(--text-primary)]"
        onClick={onGoUp}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        type="button"
        className="rounded-[var(--radius-sm)] border-none bg-none px-[var(--space-1)] font-[inherit] text-[var(--text-muted)] hover:bg-[var(--hover-overlay-strong)] hover:text-[var(--text-primary)]"
        onClick={onGoHome}
      >
        /
      </button>
      {breadcrumbs.map((segment, index) => (
        <span key={segment.path} className="inline-flex items-center">
          <button
            type="button"
            className={cn(
              'rounded-[var(--radius-sm)] border-none bg-none px-[var(--space-1)] font-[inherit]',
              index === breadcrumbs.length - 1
                ? 'cursor-default font-semibold text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--hover-overlay-strong)] hover:text-[var(--text-primary)]',
            )}
            onClick={() => onEnterFolder(segment.path)}
          >
            {segment.name}
          </button>
          {index < breadcrumbs.length - 1 ? (
            <span className="select-none text-[var(--text-muted)]">/</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

interface ChangedFilesTreeProps extends BreadcrumbsProps {
  entries: DirectoryEntry[];
  dividerIndex: number;
  loading: boolean;
  selectedFile: string | null;
  footer?: ReactNode;
  onActivate: (entry: DirectoryEntry) => void;
}

export default function ChangedFilesTree(props: ChangedFilesTreeProps) {
  const emptyLabel = props.loading
    ? 'Loading folder…'
    : props.breadcrumbs.length ? 'Empty folder' : 'No files';
  return (
    <>
      <Breadcrumbs {...props} />
      {props.entries.length ? (
        <ul className="m-0 flex-1 list-none overflow-y-auto px-0 py-[var(--space-2)]">
          {props.entries.map((entry, index) => (
            <Fragment key={`${entry.kind}:${entry.path}`}>
              {index === props.dividerIndex ? (
                <li
                  className="mx-[var(--space-3)] my-[var(--space-2)] h-0 list-none border-t border-[var(--numina-border-light)] p-0"
                  aria-hidden="true"
                />
              ) : null}
              <EntryRow
                entry={entry}
                selectedFile={props.selectedFile}
                onActivate={props.onActivate}
              />
            </Fragment>
          ))}
        </ul>
      ) : (
        <div className="px-[var(--space-3)] py-[var(--space-6)] text-center text-sm text-[var(--text-muted)]">
          {emptyLabel}
        </div>
      )}
      {props.footer}
    </>
  );
}
