import type { BlueprintSettingsResponse, PullRequestMode } from '@shared/api-types';
import type { ClaudePermissionMode, CodexSandboxMode, EffortLevel, ProviderId } from '@shared/agent-events';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../server/errors';
import type { AgentConfig, BlueprintRow } from '../../store/rows';
import type { OpenProject } from '../types';

export const MAX_ORCHESTRATOR_CONCURRENCY = 4;
const PR_MODES: readonly PullRequestMode[] = ['off', 'draft', 'ready'];

export interface AgentSettingsPatch {
  provider?: ProviderId;
  model?: string;
  effort?: EffortLevel | null;
  claude_permission_mode?: ClaudePermissionMode;
  codex_sandbox?: CodexSandboxMode;
}

export interface BlueprintSettingsPatch {
  title?: string;
  description?: string;
  pr_mode?: PullRequestMode;
  auto_commit?: boolean;
  orchestrator_child_concurrency?: number;
  agent?: AgentSettingsPatch;
}

export type DesktopBlueprintSettingsResponse = BlueprintSettingsResponse & { agent: AgentConfig };

export function normalizedPrMode(mode: PullRequestMode): PullRequestMode {
  return PR_MODES.includes(mode) ? mode : 'off';
}

export function updateBlueprintSettings(
  ctx: AppContext,
  project: OpenProject,
  update: BlueprintSettingsPatch,
): DesktopBlueprintSettingsResponse {
  const patch = settingsPatch(project.blueprint, update);
  const row = ctx.registry.updateBlueprint(project.repository.id, project.blueprint.id, patch);
  project.blueprint = row;
  return {
    name: row.title || row.id,
    description: row.description ?? '',
    pr_mode: normalizedPrMode(row.pr_mode),
    auto_commit: false,
    orchestrator_child_concurrency: row.orchestrator_child_concurrency > 0 ? row.orchestrator_child_concurrency : 1,
    pr_number: null,
    pr_error: null,
    pushed: true,
    agent: row.agent,
  };
}

function settingsPatch(row: BlueprintRow, update: BlueprintSettingsPatch): Partial<BlueprintRow> {
  const patch: Partial<BlueprintRow> = {};
  if (update.title !== undefined) {
    const cleaned = update.title.trim();
    if (!cleaned) throw new HttpError(400, 'Title must not be empty', 'http_400');
    patch.title = cleaned;
  }
  if (update.description !== undefined) patch.description = update.description;
  if (update.pr_mode !== undefined) patch.pr_mode = update.pr_mode;
  if (update.auto_commit !== undefined) patch.auto_commit = false;
  if (update.orchestrator_child_concurrency !== undefined) {
    if (update.orchestrator_child_concurrency > MAX_ORCHESTRATOR_CONCURRENCY) {
      throw new HttpError(422, `Orchestrator concurrency cannot exceed ${MAX_ORCHESTRATOR_CONCURRENCY}.`, 'http_422');
    }
    patch.orchestrator_child_concurrency = update.orchestrator_child_concurrency;
  }
  if (update.agent) patch.agent = { ...row.agent, ...update.agent };
  return patch;
}
