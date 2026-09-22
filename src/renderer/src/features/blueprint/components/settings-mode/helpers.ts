import {
  ApiError,
  DEFAULT_BLUEPRINT_AGENT_CONFIG,
  type BlueprintAgentConfig,
} from '@/lib/api';
import { EFFORT_LEVELS, type EffortLevel, type ProviderId } from '@shared/agent-events';

import type { BlueprintRef } from './types';

export const SETTINGS_SECTIONS = [
  {
    id: 'general',
    label: 'General',
    description: 'Manage this workspace. Preferences stay on this computer, outside the repository.',
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Choose the agent and model for new chats in this workspace.',
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

export const PROVIDER_OPTIONS: { value: ProviderId; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

export const EFFORT_OPTIONS: { value: EffortLevel | ''; label: string }[] = [
  { value: '', label: 'CLI default' },
  ...EFFORT_LEVELS.map((level) => ({ value: level, label: level })),
];

export function agentConfigOf(blueprint: BlueprintRef): BlueprintAgentConfig {
  return { ...DEFAULT_BLUEPRINT_AGENT_CONFIG, ...(blueprint.agent ?? {}) };
}

export function sameAgentConfig(left: BlueprintAgentConfig, right: BlueprintAgentConfig): boolean {
  return left.provider === right.provider
    && left.model.trim() === right.model.trim()
    && left.effort === right.effort
    && left.claude_permission_mode === right.claude_permission_mode
    && left.codex_sandbox === right.codex_sandbox;
}

export function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'A blueprint with this name already exists.';
    if (error.status === 422) return 'Check the settings and try again.';
    if (error.status === 403) return 'You do not have permission to update this blueprint.';
    if (error.status === 404) return 'We could not find this blueprint.';
  }
  return 'Could not save settings. Please try again.';
}

export function sourceUpdateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "The folder isn't ready yet. Try again in a moment.";
    if (error.status === 422) return 'That file has no leanblueprint declarations Fuse can parse.';
    if (error.status === 404) return 'That file no longer exists in this folder.';
  }
  return 'Could not update the blueprint source.';
}

export function removeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && error.message) return error.message;
  return 'Could not remove this workspace. Please try again.';
}
