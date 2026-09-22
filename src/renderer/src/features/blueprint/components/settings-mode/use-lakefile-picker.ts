import { useState } from 'react';

import {
  discoverLakefiles,
  setBlueprintLeanProject,
  type LakefileEntry,
} from '@/lib/api';

interface UseLakefilePickerOptions {
  owner: string;
  repo: string;
  blueprintId: string;
  projectSubdir: string;
  readonly: boolean;
  beforeProjectChange?: () => Promise<boolean>;
  onProjectUpdated?: (directory: string) => void;
}

export function useLakefilePicker(options: UseLakefilePickerOptions) {
  const [open, setOpen] = useState(false);
  const [lakefiles, setLakefiles] = useState<LakefileEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  async function openPicker() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const response = await discoverLakefiles(options.owner, options.repo);
      setLakefiles(response.lakefiles);
      setTruncated(response.truncated);
      const current = response.lakefiles.find(
        (file) => file.directory === options.projectSubdir,
      );
      setSelected(current?.path ?? '');
    } catch {
      setError('Could not find lakefiles in this repository.');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!selected || saving || options.readonly) return;
    setSaving(true);
    setError(null);
    try {
      const ready = !options.beforeProjectChange || await options.beforeProjectChange();
      if (!ready) throw new Error('Save your open file changes before switching projects.');
      const result = await setBlueprintLeanProject(
        options.owner, options.repo, options.blueprintId, selected,
      );
      options.onProjectUpdated?.(result.project_subdir);
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not change the Lean project.');
    } finally {
      setSaving(false);
    }
  }

  function setPickerOpen(next: boolean) {
    if (!saving) setOpen(next);
  }

  return {
    open,
    setOpen: setPickerOpen,
    lakefiles,
    selected,
    setSelected,
    loading,
    saving,
    error,
    truncated,
    openPicker,
    save,
  };
}

export type LakefilePickerState = ReturnType<typeof useLakefilePicker>;
