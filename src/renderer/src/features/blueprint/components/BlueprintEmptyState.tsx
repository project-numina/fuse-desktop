import { useState } from 'react';

import {
  ApiError,
  createBlueprint,
  fetchWorkspaceBlueprintCandidates,
  setBlueprintSourceFile,
  type RepositoryBlueprintFile,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/features/blueprint/components/ConfirmDialog';
import SourceFilePickerDialog from '@/features/blueprint/components/SourceFilePickerDialog';

/**
 * Empty-state screen for a workspace with no blueprint yet.
 *
 * Rendered in place of the editor when the workspace has no `blueprint_file`.
 * Offers two paths to a working
 * blueprint: create a fresh Fuse-drafted entrypoint, or adopt an existing
 * leanblueprint `.tex` already in the repository.
 *
 * It takes `owner` / `repo` / `blueprintId` as props, reports success via
 * `onBlueprintReady`, and calls the API client directly.
 */

/** Source summary returned once a blueprint exists. */
export interface BlueprintReadyPayload {
  blueprint_file: string;
  included_files: string[];
  entry_count: number;
}

export interface BlueprintEmptyStateProps {
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Blueprint (workspace) identifier. */
  blueprintId: string;
  /** Whether workspace ownership or lifecycle state forbids changes. */
  readonly?: boolean;
  /** Explanation shown when the workspace is read-only. */
  readonlyMessage?: string;
  /** Invoked with the source summary once a blueprint is created or adopted. */
  onBlueprintReady: (payload: BlueprintReadyPayload) => void;
}

function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "The folder isn't ready yet. Try again in a moment.";
  }
  return 'Could not create a blueprint. Please try again.';
}

function selectErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "The folder isn't ready yet. Try again in a moment.";
    }
    if (error.status === 422) {
      return 'That file has no leanblueprint declarations Fuse can parse.';
    }
    if (error.status === 404) return 'That file no longer exists in this folder.';
  }
  return 'Could not adopt that blueprint source.';
}

function BlueprintEmptyState({
  owner,
  repo,
  blueprintId,
  readonly = false,
  readonlyMessage = 'This project is read-only.',
  onBlueprintReady,
}: BlueprintEmptyStateProps) {
  // --- Create a new blueprint ---
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);

  async function handleCreateBlueprint() {
    if (creating || readonly) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await createBlueprint(owner, repo, blueprintId);
      onBlueprintReady(response);
    } catch (error) {
      setCreateError(createErrorMessage(error));
    } finally {
      setCreating(false);
      setConfirmCreateOpen(false);
    }
  }

  // --- Select an existing .tex ---
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<RepositoryBlueprintFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  async function openPicker() {
    if (readonly) return;
    setPickerOpen(true);
    setSourceError(null);
    setSelectedPath(null);
    setSourceLoading(true);
    try {
      const response = await fetchWorkspaceBlueprintCandidates(owner, repo, blueprintId);
      setSourceFiles(response.files);
    } catch {
      setSourceFiles([]);
      setSourceError('Could not load .tex files from the repository.');
    } finally {
      setSourceLoading(false);
    }
  }

  function closePicker() {
    if (sourceSaving) return;
    setPickerOpen(false);
    setSelectedPath(null);
    setSourceError(null);
  }

  async function confirmSelection() {
    if (!selectedPath || sourceSaving) return;
    setSourceSaving(true);
    setSourceError(null);
    try {
      const response = await setBlueprintSourceFile(owner, repo, blueprintId, selectedPath);
      onBlueprintReady(response);
    } catch (error) {
      setSourceError(selectErrorMessage(error));
    } finally {
      setSourceSaving(false);
    }
  }

  return (
    <div className="flex h-full items-start justify-center px-6 pt-24 pb-6">
      <div className="flex w-full max-w-lg flex-col items-center gap-3 text-center">
        <h2 className="m-0 text-lg font-semibold text-foreground">No blueprint yet</h2>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          {readonly
            ? readonlyMessage
            : 'Select an existing blueprint or create a new one.'}
        </p>

        {!readonly && (
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button
              variant="default"
              className="min-w-56 px-4 py-2"
              disabled={creating}
              onClick={() => setConfirmCreateOpen(true)}
            >
              {creating ? 'Creating…' : 'Create a new blueprint'}
            </Button>
            <Button
              variant="outline"
              className="min-w-56 px-4 py-2"
              disabled={creating}
              onClick={openPicker}
            >
              Select an existing blueprint
            </Button>
          </div>
        )}

        {createError && (
          <p className="m-0 text-xs text-[var(--build-error)]">{createError}</p>
        )}
      </div>

      <SourceFilePickerDialog
        open={pickerOpen}
        files={sourceFiles}
        selectedPath={selectedPath}
        loading={sourceLoading}
        saving={sourceSaving}
        error={sourceError}
        description={
          <>
            Pick an existing leanblueprint <code>.tex</code> entrypoint in this repository.
          </>
        }
        savingLabel="Adopting…"
        errorClassName="text-[var(--build-error)]"
        onOpenChange={(next) => {
          if (!next) closePicker();
        }}
        onSelect={setSelectedPath}
        onConfirm={confirmSelection}
      />

      <ConfirmDialog
        open={confirmCreateOpen}
        title="Create a new blueprint?"
        message={
          'Fuse will scaffold a new leanblueprint at blueprint/src/content.tex ' +
          "in this folder. This can't be undone."
        }
        confirmLabel="Create blueprint"
        busy={creating}
        onConfirm={handleCreateBlueprint}
        onCancel={() => {
          if (!creating) setConfirmCreateOpen(false);
        }}
      />
    </div>
  );
}

export default BlueprintEmptyState;
