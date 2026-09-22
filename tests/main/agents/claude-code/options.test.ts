import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, buildClaudeEnvironment } from '@main/agents/claude-code/options';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';
import type { ThreadLaunch } from '@main/agents/types';

function launch(overrides: Partial<ThreadLaunch> = {}): ThreadLaunch {
  return {
    threadId: 'thread-1',
    repoPath: '/repo',
    config: { ...DEFAULT_AGENT_CONFIG, provider: 'claude' },
    providerThreadId: null,
    executable: '',
    ...overrides,
  };
}

describe('Claude Code options', () => {
  it('maps optional SDK arguments and resumes last', () => {
    const args = buildClaudeArgs(
      launch({
        claude: {
          systemPrompt: 'replace',
          appendSystemPrompt: 'append',
          mcpConfigJson: '{"mcpServers":{}}',
          addDirs: ['/one', '/two'],
          disallowedTools: ['WebFetch'],
        },
      }),
      'session-1',
    );

    expect(args).toEqual(expect.arrayContaining([
      '--system-prompt',
      'replace',
      '--append-system-prompt',
      'append',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--strict-mcp-config',
      '--add-dir',
      '/one',
      '--add-dir',
      '/two',
      '--disallowedTools',
      'WebFetch',
    ]));
    expect(args.slice(-2)).toEqual(['--resume', 'session-1']);
  });

  it('lets launch environment values override process defaults', () => {
    const environment = buildClaudeEnvironment(
      launch({ env: { MCP_TOOL_TIMEOUT: '1000', CLAUDE_CODE_DISABLE_CRON: 'custom' } }),
    );

    expect(environment).toMatchObject({
      MCP_TOOL_TIMEOUT: '1000',
      CLAUDE_CODE_DISABLE_CRON: 'custom',
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    });
  });
});
