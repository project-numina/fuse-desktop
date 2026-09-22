import { useRef, useState } from 'react';

import {
  fetchWorkspaceBlueprintCandidates,
  setBlueprintSourceFile,
  type RepositoryBlueprintFile,
} from '@/lib/api';

import { sourceUpdateErrorMessage } from './helpers';
import type { SourceUpdatedPayload } from './types';

interface UseSourcePickerOptions {
  owner: string;
  repo: string;
  blueprintId: string;
  readonly: boolean;
  onSourceUpdated?: (value: SourceUpdatedPayload) => void;
}

export function useSourcePicker(options: UseSourcePickerOptions) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<RepositoryBlueprintFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestId = useRef(0);

  async function openPicker() {
    if (options.readonly) return;
    setOpen(true);
    setError(null);
    setSuccess(null);
    setSelectedPath(null);
    setLoading(true);
    const currentRequest = ++requestId.current;
    try {
      const response = await fetchWorkspaceBlueprintCandidates(
        options.owner, options.repo, options.blueprintId,
      );
      if (currentRequest === requestId.current) setFiles(response.files);
    } catch {
      if (currentRequest !== requestId.current) return;
      setFiles([]);
      setError('Could not load .tex files from the repository.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  function closePicker() {
    if (saving) return;
    setOpen(false);
    setSelectedPath(null);
    setError(null);
  }

  async function confirm() {
    if (!selectedPath || saving || options.readonly) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await setBlueprintSourceFile(
        options.owner, options.repo, options.blueprintId, selectedPath,
      );
      options.onSourceUpdated?.(response);
      setSuccess(`Source updated — ${response.entry_count} declarations`);
      setOpen(false);
      setSelectedPath(null);
    } catch (saveError) {
      setError(sourceUpdateErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return {
    open,
    files,
    selectedPath,
    setSelectedPath,
    loading,
    saving,
    error,
    success,
    openPicker,
    closePicker,
    confirm,
  };
}

export type SourcePickerState = ReturnType<typeof useSourcePicker>;
