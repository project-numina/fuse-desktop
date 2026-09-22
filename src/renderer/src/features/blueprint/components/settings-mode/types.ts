import type { BlueprintAgentConfig } from '@/lib/api';

export type PullRequestMode = 'off' | 'draft' | 'ready';

export interface BlueprintRef {
  id?: string;
  name?: string;
  description?: string;
  pr_mode?: PullRequestMode;
  auto_commit?: boolean;
  orchestrator_child_concurrency?: number;
  open_pr_number?: number | null;
  blueprint_file?: string;
  project_subdir?: string;
  /** Desktop-only: which CLI runs this workspace's chats and how. */
  agent?: BlueprintAgentConfig | null;
}

export interface SettingsUpdatedPayload {
  name: string;
  description: string;
  pr_mode: PullRequestMode;
  auto_commit: boolean;
  orchestrator_child_concurrency: number;
  pr_number: number | null;
  agent?: BlueprintAgentConfig;
}

export interface SourceUpdatedPayload {
  blueprint_file: string;
  included_files: string[];
  entry_count: number;
}

export interface SettingsModeProps {
  blueprint: BlueprintRef;
  owner: string;
  repo: string;
  blueprintId: string;
  readonly?: boolean;
  readonlyReason?: string;
  onUpdated?: (value: SettingsUpdatedPayload) => void;
  onSourceUpdated?: (value: SourceUpdatedPayload) => void;
  onProjectUpdated?: (directory: string) => void;
  beforeProjectChange?: () => Promise<boolean>;
  /** Called after the workspace registry entry is removed; files stay on disk. */
  onRemoved?: () => void;
}
