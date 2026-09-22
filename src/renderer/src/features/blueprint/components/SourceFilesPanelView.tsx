import type { MouseEvent } from 'react';

import AddSourceDialog from '@/features/blueprint/components/AddSourceDialog';
import ConfirmDialog from '@/features/blueprint/components/ConfirmDialog';
import type { SourceFilesPanelController } from '@/features/blueprint/components/use-source-files-panel';
import type { RepositorySource } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SourceFilesPanelViewProps {
  sources: RepositorySource[];
  selectedSourceId: string;
  loading: boolean;
  error: boolean;
  collapsed: boolean;
  hideable: boolean;
  rail: boolean;
  owner: string;
  repository: string;
  blueprintId: string;
  readonly: boolean;
  onSelectSource?: (sourceId: string) => void;
  onToggleCollapsed?: () => void;
  controller: SourceFilesPanelController;
}

const STATUS_BADGES: Record<string, string> = {
  ocr_running: 'OCR',
  failed: 'Failed',
};

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  const points = direction === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6';
  return (
    <svg
      className={direction === 'left' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points={points} />
    </svg>
  );
}

function CollapsedHandle({ onToggle }: { onToggle?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Show sources panel"
      title="Show sources panel"
      className="fixed right-0 top-1/2 z-20 flex h-14 w-[22px] -translate-y-1/2 items-center justify-center rounded-l-[28px] border border-r-0 border-border bg-card text-muted-foreground shadow-[-2px_0_8px_rgb(0_0_0/8%)] transition-colors hover:w-[26px] hover:bg-muted hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={onToggle}
    >
      <Chevron direction="left" />
    </button>
  );
}

function HideHandle({ onToggle }: { onToggle?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Hide sources panel"
      title="Hide sources panel"
      className="absolute right-0 top-1/2 z-[3] flex h-10 w-[14px] translate-x-full -translate-y-1/2 items-center justify-center rounded-r-[20px] border border-l-0 border-border bg-card text-muted-foreground shadow-[2px_0_6px_rgb(0_0_0/6%)] transition-colors hover:w-[18px] hover:bg-muted hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={onToggle}
    >
      <Chevron direction="right" />
    </button>
  );
}

function PanelHeader({ readonly, onAdd }: { readonly: boolean; onAdd: () => void }) {
  return (
    <div className="relative flex flex-shrink-0 items-center justify-between gap-2 border-b border-border p-3">
      <span className="text-sm font-semibold leading-[1.5] text-foreground">Sources</span>
      {!readonly && (
        <button
          type="button"
          className="inline-flex items-center rounded-full border border-border px-[0.65rem] py-[0.2rem] text-xs font-semibold leading-[1.5] text-primary transition-colors hover:border-primary hover:bg-[var(--hover-overlay)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onAdd}
        >
          Add
        </button>
      )}
    </div>
  );
}

function StatusBadge({ source }: { source: RepositorySource }) {
  const badge = source.status && STATUS_BADGES[source.status];
  if (!badge) return null;
  return (
    <span className={cn(
      'ml-auto flex-shrink-0 rounded-full px-[7px] py-px text-[0.625rem] font-semibold uppercase tracking-[0.03em]',
      source.status === 'failed'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground',
    )}>
      {badge}
    </span>
  );
}

function DeleteIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

interface DeleteButtonProps {
  disabled: boolean;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
}

function DeleteButton({ disabled, onDelete }: DeleteButtonProps) {
  return (
    <button
      type="button"
      title="Delete source"
      disabled={disabled}
      className="ml-1 flex h-[22px] w-[22px] flex-shrink-0 cursor-pointer items-center justify-center text-muted-foreground opacity-60 transition-opacity hover:text-destructive hover:opacity-100 disabled:cursor-default disabled:opacity-40"
      onClick={onDelete}
    >
      <DeleteIcon />
    </button>
  );
}

interface SourceRowProps {
  source: RepositorySource;
  selected: boolean;
  readonly: boolean;
  deleting: boolean;
  onSelect?: (sourceId: string) => void;
  onDelete: (source: RepositorySource) => void;
}

function SourceRow({
  source,
  selected,
  readonly,
  deleting,
  onSelect,
  onDelete,
}: SourceRowProps) {
  function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onDelete(source);
  }
  return (
    <li
      className={cn(
        'flex cursor-pointer items-center gap-2 border-l-2 border-transparent px-3 py-1 font-mono text-xs text-foreground transition-colors hover:bg-muted',
        selected && 'border-l-primary font-semibold text-primary',
      )}
      onClick={() => onSelect?.(source.id)}
    >
      <span className="block min-w-0 flex-1 truncate">{source.display_name}</span>
      <StatusBadge source={source} />
      {!readonly && !source.metadata?.legacy && (
        <DeleteButton disabled={deleting} onDelete={handleDelete} />
      )}
    </li>
  );
}

interface SourceListProps {
  sources: RepositorySource[];
  selectedSourceId: string;
  readonly: boolean;
  controller: SourceFilesPanelController;
  onSelectSource?: (sourceId: string) => void;
}

function SourceList({
  sources,
  selectedSourceId,
  readonly,
  controller,
  onSelectSource,
}: SourceListProps) {
  return (
    <ul className="m-0 flex-1 list-none overflow-y-auto py-2 pl-0">
      {sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          selected={source.id === selectedSourceId}
          readonly={readonly}
          deleting={controller.deletingSourceIds.has(source.id)}
          onSelect={onSelectSource}
          onDelete={controller.requestSourceDelete}
        />
      ))}
    </ul>
  );
}

function PanelBody({
  loading,
  error,
  sources,
  ...listProps
}: Pick<SourceFilesPanelViewProps,
  'loading' | 'error' | 'sources' | 'selectedSourceId' | 'readonly' | 'onSelectSource' | 'controller'
>) {
  if (loading) return <PanelMessage>Loading sources...</PanelMessage>;
  if (error) return <PanelMessage error>Could not load repository sources.</PanelMessage>;
  if (sources.length === 0) return <PanelMessage>No source files yet.</PanelMessage>;
  return <SourceList sources={sources} {...listProps} />;
}

function PanelMessage({ children, error = false }: {
  children: string;
  error?: boolean;
}) {
  return (
    <div className={cn(
      'flex flex-1 flex-col items-center justify-center px-3 py-6 text-center text-sm',
      error ? 'text-destructive' : 'text-muted-foreground',
    )}>
      {children === 'No source files yet.' ? <p className="m-0">{children}</p> : children}
    </div>
  );
}

function PanelDialogs({
  owner,
  repository,
  blueprintId,
  controller,
}: Pick<SourceFilesPanelViewProps, 'owner' | 'repository' | 'blueprintId' | 'controller'>) {
  return (
    <>
      <AddSourceDialog
        open={controller.addSourceDialogOpen}
        owner={owner}
        repository={repository}
        blueprintId={blueprintId}
        existingNames={controller.existingSourceNames}
        repositoryAction="import"
        onOpenChange={controller.setAddSourceDialogOpen}
        onUploaded={controller.uploadSource}
        onSelectRepoFile={controller.importSource}
      />
      <ConfirmDialog
        open={!!controller.sourceToDelete}
        title="Delete source?"
        message={controller.deleteMessage}
        confirmLabel="Delete"
        destructive
        busy={!!controller.sourceToDelete
          && controller.deletingSourceIds.has(controller.sourceToDelete.id)}
        onConfirm={controller.confirmDelete}
        onCancel={controller.cancelDelete}
      />
    </>
  );
}

export default function SourceFilesPanelView(props: SourceFilesPanelViewProps) {
  if (props.hideable && props.collapsed) {
    return <CollapsedHandle onToggle={props.onToggleCollapsed} />;
  }
  return (
    <div className={cn(
      'relative flex w-full flex-col',
      props.rail ? 'h-full min-h-0' : 'h-[min(55vh,540px)] min-h-[360px]',
    )}>
      {props.hideable && <HideHandle onToggle={props.onToggleCollapsed} />}
      <aside className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-card',
        props.rail
          ? 'rounded-none border-0 shadow-none'
          : 'rounded-lg border border-border shadow-[var(--numina-shadow)]',
      )}>
        <PanelHeader
          readonly={props.readonly}
          onAdd={() => props.controller.setAddSourceDialogOpen(true)}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PanelBody {...props} />
          {props.controller.sourceDeleteError && (
            <p className="mt-3 px-3 text-sm text-destructive">
              {props.controller.sourceDeleteError}
            </p>
          )}
        </div>
      </aside>
      <PanelDialogs {...props} />
    </div>
  );
}
