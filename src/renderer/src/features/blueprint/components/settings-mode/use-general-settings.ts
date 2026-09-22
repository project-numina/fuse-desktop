import { useEffect, useMemo, useState } from 'react';

import {
  updateBlueprintSettings,
  type BlueprintSettingsResponse,
  type BlueprintSettingsUpdate,
} from '@/lib/api';

import { saveErrorMessage } from './helpers';
import type { BlueprintRef, SettingsUpdatedPayload } from './types';

interface UseGeneralSettingsOptions {
  blueprint: BlueprintRef;
  owner: string;
  repo: string;
  blueprintId: string;
  readonly: boolean;
  operationLock: { current: 'general' | 'agent' | null };
  onUpdated?: (value: SettingsUpdatedPayload) => void;
}

export function useGeneralSettings(options: UseGeneralSettingsOptions) {
  const { blueprint, owner, repo, blueprintId, readonly, operationLock, onUpdated } = options;
  const [title, setTitle] = useState(blueprint.name ?? '');
  const [description, setDescription] = useState(blueprint.description ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setTitle(blueprint.name ?? '');
    setDescription(blueprint.description ?? '');
    setErrorMessage(null);
    setSuccessMessage(null);
    // Drafts intentionally survive prop refreshes and reset only for a new workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint.id]);

  const trimmedTitle = title.trim();
  const isDirty = useMemo(() => (
    trimmedTitle !== (blueprint.name ?? '').trim()
      || description !== (blueprint.description ?? '')
  ), [trimmedTitle, description, blueprint]);
  const canSave = !readonly && isDirty && trimmedTitle.length > 0;

  async function saveSettings() {
    if (!canSave || operationLock.current) return;
    operationLock.current = 'general';
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const body: BlueprintSettingsUpdate = { title: trimmedTitle, description };
    try {
      const response = (await updateBlueprintSettings(
        owner, repo, blueprintId, body,
      )) as BlueprintSettingsResponse;
      onUpdated?.({ ...response });
      setSuccessMessage('Settings saved.');
    } catch (error) {
      setErrorMessage(saveErrorMessage(error));
    } finally {
      if (operationLock.current === 'general') operationLock.current = null;
      setSaving(false);
    }
  }

  return {
    title,
    setTitle,
    description,
    setDescription,
    saving,
    canSave,
    errorMessage,
    successMessage,
    saveSettings,
  };
}

export type GeneralSettingsState = ReturnType<typeof useGeneralSettings>;
