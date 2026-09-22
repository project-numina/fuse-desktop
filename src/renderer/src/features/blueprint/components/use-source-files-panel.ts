import { useMemo, useState } from 'react';

import {
  deleteRepositorySource,
  importRepositorySource,
  type RepositoryFileEntry,
  type RepositorySource,
} from '@/lib/api';

interface SourceFilesPanelActionsOptions {
  sources: RepositorySource[];
  owner: string;
  repository: string;
  blueprintId: string;
  readonly: boolean;
  onUploaded?: (source: RepositorySource) => void;
  onDeleted?: (sourceId: string) => void;
}

interface DeleteSelection {
  sourceDeleteError: string | null;
  sourceToDelete: RepositorySource | null;
  requestSourceDelete: (source: RepositorySource) => void;
  cancelDelete: () => void;
  deleteFailed: () => void;
}

interface SourceDeletionOptions {
  source: RepositorySource | null;
  owner: string;
  repository: string;
  blueprintId: string;
  onDeleted?: (sourceId: string) => void;
  onComplete: () => void;
  onFailure: () => void;
}

export interface SourceFilesPanelController {
  addSourceDialogOpen: boolean;
  deletingSourceIds: Set<string>;
  sourceDeleteError: string | null;
  sourceToDelete: RepositorySource | null;
  existingSourceNames: string[];
  deleteMessage: string;
  setAddSourceDialogOpen: (open: boolean) => void;
  requestSourceDelete: (source: RepositorySource) => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
  uploadSource: (source: RepositorySource) => void;
  importSource: (file: RepositoryFileEntry) => Promise<void>;
}

function sourceDeleteMessage(source: RepositorySource | null): string {
  if (!source) return '';
  const scope = source.metadata?.project_scoped
    ? 'this workspace'
    : 'all your workspaces in this repository';
  return `"${source.display_name}" will be removed for ${scope}. This cannot be undone.`;
}

function useDeleteSelection(readonly: boolean): DeleteSelection {
  const [sourceToDelete, setSourceToDelete] = useState<RepositorySource | null>(null);
  const [sourceDeleteError, setSourceDeleteError] = useState<string | null>(null);
  function requestSourceDelete(source: RepositorySource) {
    if (readonly) return;
    setSourceDeleteError(null);
    setSourceToDelete(source);
  }
  return {
    sourceDeleteError,
    sourceToDelete,
    requestSourceDelete,
    cancelDelete: () => setSourceToDelete(null),
    deleteFailed: () => {
      setSourceDeleteError('Could not delete source. Try again.');
      setSourceToDelete(null);
    },
  };
}

function useSourceDeletion({
  source,
  owner,
  repository,
  blueprintId,
  onDeleted,
  onComplete,
  onFailure,
}: SourceDeletionOptions) {
  const [deletingSourceIds, setDeletingSourceIds] = useState<Set<string>>(new Set());
  async function confirmDelete() {
    if (!source || deletingSourceIds.has(source.id)) return;
    setDeletingSourceIds((current) => new Set(current).add(source.id));
    try {
      await deleteRepositorySource(owner, repository, source.id, blueprintId);
      onDeleted?.(source.id);
      onComplete();
    } catch {
      onFailure();
    } finally {
      setDeletingSourceIds((current) => {
        const next = new Set(current);
        next.delete(source.id);
        return next;
      });
    }
  }
  return { deletingSourceIds, confirmDelete };
}

export function useSourceFilesPanel({
  sources,
  owner,
  repository,
  blueprintId,
  readonly,
  onUploaded,
  onDeleted,
}: SourceFilesPanelActionsOptions): SourceFilesPanelController {
  const [addSourceDialogOpen, setAddSourceDialogOpen] = useState(false);
  const selection = useDeleteSelection(readonly);
  const deletion = useSourceDeletion({
    source: selection.sourceToDelete,
    owner,
    repository,
    blueprintId,
    onDeleted,
    onComplete: selection.cancelDelete,
    onFailure: selection.deleteFailed,
  });
  const existingSourceNames = useMemo(
    () => sources.map((source) => source.display_name),
    [sources],
  );
  async function importSource(file: RepositoryFileEntry) {
    const source = await importRepositorySource(owner, repository, blueprintId, file.path);
    onUploaded?.(source);
  }

  return {
    addSourceDialogOpen,
    deletingSourceIds: deletion.deletingSourceIds,
    sourceDeleteError: selection.sourceDeleteError,
    sourceToDelete: selection.sourceToDelete,
    existingSourceNames,
    deleteMessage: sourceDeleteMessage(selection.sourceToDelete),
    setAddSourceDialogOpen,
    requestSourceDelete: selection.requestSourceDelete,
    confirmDelete: deletion.confirmDelete,
    cancelDelete: selection.cancelDelete,
    uploadSource: (source) => onUploaded?.(source),
    importSource,
  };
}
