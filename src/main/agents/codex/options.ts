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

/** Send long instructions and private launch settings over stdio, including on Windows. */
export function threadOptions(launch: ThreadLaunch): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (launch.config.effort) config.model_reasoning_effort = launch.config.effort;
  config.mcp_servers = launch.codex?.mcpServers ?? {};
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
