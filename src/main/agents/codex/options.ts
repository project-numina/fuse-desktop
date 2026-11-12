import type { ThreadLaunch } from '../types';

/** Keep native collaboration enabled while retaining Fuse's existing feature boundaries. */
export const CODEX_FEATURE_OVERRIDES = [
  'features.multi_agent=true', 'features.multi_agent_v2=false',
  'features.code_mode=false', 'features.apps=false', 'features.browser_use=false',
  'features.computer_use=false', 'features.plugins=false', 'features.image_generation=false',
  'features.goals=false', 'web_search="disabled"',
] as const;

export function buildCodexArgs(): string[] {
  return ['app-server', ...CODEX_FEATURE_OVERRIDES.flatMap((value) => ['-c', value])];
}

/** Native Codex requires a delegation request in user or project instructions. */
export function buildCodexTurnText(launch: ThreadLaunch, text: string): string {
  if (!launch.codex?.roles || Object.keys(launch.codex.roles).length === 0) return text;
  return [
    'FUSE WORKFLOW REQUEST',
    'Use the configured fuse:* role subagents for substantive proof, formalization, research, and independent review work in this task. Delegate independent work in parallel when useful, wait for the required results, then verify and combine them. Do not ask for separate permission merely to use these subagents.',
    'This is the default Fuse workflow. Any explicit instructions in this conversation to work alone, avoid subagents, or restrict delegation take precedence over this default. Simple questions with no useful delegated work can be answered directly. This request does not expand the task scope or change sandbox and action approval requirements.',
    '',
    text,
  ].join('\n');
}

/** Send long instructions and private launch settings over stdio, including on Windows. */
export function threadOptions(launch: ThreadLaunch): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (launch.config.effort) config.model_reasoning_effort = launch.config.effort;
  config.mcp_servers = launch.codex?.mcpServers ?? {};
  if (launch.codex?.shellEnvironment) config.shell_environment_policy = { set: launch.codex.shellEnvironment };
  config.agents = { max_threads: 8, max_depth: 1, ...launch.codex?.roles };
  return {
    cwd: launch.repoPath,
    ...(launch.config.model ? { model: launch.config.model } : {}),
    approvalPolicy: 'never',
    sandbox: launch.config.codex_sandbox,
    developerInstructions: launch.codex?.developerInstructions ?? null,
    config,
  };
}
