import type { ThreadLaunch } from '../types';

/**
 * Build the fixed stream-json transport flags and the launch-specific Claude
 * Code SDK options. Secrets prefer file-backed options so they never appear
 * in the process command line.
 */
export function buildClaudeArgs(launch: ThreadLaunch, sessionId: string | null): string[] {
  const { config } = launch;
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Subagent prose only reaches stdout with this flag.
    '--forward-subagent-text',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    config.claude_permission_mode,
  ];
  if (config.claude_permission_mode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  }
  if (config.model) args.push('--model', config.model);
  if (config.effort) args.push('--effort', config.effort);
  appendClaudeOptions(args, launch);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

function appendClaudeOptions(args: string[], launch: ThreadLaunch): void {
  const options = launch.claude ?? {};
  if (options.systemPrompt) args.push('--system-prompt', options.systemPrompt);
  if (options.systemPromptFile) args.push('--system-prompt-file', options.systemPromptFile);
  if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt);
  if (options.pluginDir) args.push('--plugin-dir', options.pluginDir);
  // A file keeps the MCP server's token off the command line (and off cmd.exe).
  if (options.mcpConfigFile) args.push('--mcp-config', options.mcpConfigFile, '--strict-mcp-config');
  else if (options.mcpConfigJson) args.push('--mcp-config', options.mcpConfigJson, '--strict-mcp-config');
  for (const directory of options.addDirs ?? []) args.push('--add-dir', directory);
  if (options.allowedTools?.length) args.push('--allowedTools', ...options.allowedTools);
  if (options.disallowedTools?.length) args.push('--disallowedTools', ...options.disallowedTools);
  if (options.maxTurns) args.push('--max-turns', String(options.maxTurns));
}

/** Environment invariants needed for one persistent stream-json process. */
export function buildClaudeEnvironment(launch: ThreadLaunch): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_CODE_DISABLE_CRON: '1',
    // Background Task calls finish in a CLI-initiated turn this adapter would
    // otherwise drop, so child agents must block their owning turn.
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    // Mirrors the hosted backend's three-hour MCP tool timeout.
    MCP_TOOL_TIMEOUT: '10800000',
    ...launch.env,
  };
}
