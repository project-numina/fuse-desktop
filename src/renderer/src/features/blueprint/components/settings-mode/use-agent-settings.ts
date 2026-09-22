import { useEffect, useRef, useState } from 'react';

import {
  updateBlueprintSettings,
  type BlueprintAgentConfig,
  type BlueprintSettingsResponse,
} from '@/lib/api';

import { agentConfigOf, sameAgentConfig, saveErrorMessage } from './helpers';
import type { BlueprintRef, SettingsUpdatedPayload } from './types';

interface UseAgentSettingsOptions {
  blueprint: BlueprintRef;
  owner: string;
  repo: string;
  blueprintId: string;
  readonly: boolean;
  operationLock: { current: 'general' | 'agent' | null };
  onUpdated?: (value: SettingsUpdatedPayload) => void;
}

export function useAgentSettings(options: UseAgentSettingsOptions) {
  const { blueprint, owner, repo, blueprintId, readonly, operationLock, onUpdated } = options;
  const [agent, setAgent] = useState<BlueprintAgentConfig>(() => agentConfigOf(blueprint));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<object | null>(null);

  useEffect(() => {
    setAgent(agentConfigOf(blueprint));
    activeRequest.current = null;
    if (operationLock.current === 'agent') operationLock.current = null;
    setSaving(false);
    setError(null);
    return () => { activeRequest.current = null; };
    // Local changes win until the user navigates to a different workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint.id]);

  async function updateAgent(patch: Partial<BlueprintAgentConfig>): Promise<boolean> {
    if (readonly || activeRequest.current || operationLock.current) return false;
    const next = { ...agent, ...patch, model: (patch.model ?? agent.model).trim() };
    if (sameAgentConfig(next, agent)) return true;

    const request = {};
    activeRequest.current = request;
    operationLock.current = 'agent';
    setSaving(true);
    setError(null);
    try {
      const response = (await updateBlueprintSettings(
        owner, repo, blueprintId, { agent: next },
      )) as BlueprintSettingsResponse;
      if (activeRequest.current !== request) return false;
      const saved = response.agent ?? next;
      setAgent(saved);
      onUpdated?.({ ...response, agent: saved });
      return true;
    } catch (requestError) {
      if (activeRequest.current === request) setError(saveErrorMessage(requestError));
      return false;
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        if (operationLock.current === 'agent') operationLock.current = null;
        setSaving(false);
      }
    }
  }

  return { agent, saving, error, updateAgent };
}

export type AgentSettingsState = ReturnType<typeof useAgentSettings>;
