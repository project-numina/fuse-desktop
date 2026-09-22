import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appPaths } from '@main/paths';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';
import { buildThreadLaunch, codexMcpBootstrap, type LaunchInput } from '@main/services/sessions/launch';
import { fakeProject } from '@test/main/services/sessions/test-helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function input(provider: 'claude' | 'codex'): LaunchInput {
  const dataDir = mkdtempSync(join(tmpdir(), 'fuse-launch-'));
  dirs.push(dataDir);
  return {
    conversationId: 'conv-1',
    project: fakeProject('/repo', { agent: { ...DEFAULT_AGENT_CONFIG, provider } }),
    paths: appPaths(dataDir),
    resourcesDir: join(dataDir, 'resources'),
    server: { baseUrl: 'http://127.0.0.1:4321', token: 'secret-token' },
    executable: '',
    providerThreadId: null,
    mcpServerPath: '/app/out/main/mcp-server.js',
    leanModule: 'Sample',
  };
}

describe('buildThreadLaunch', () => {
  it('keeps the loopback token out of the CLI environment and the Codex command line', () => {
    const launch = buildThreadLaunch(input('codex'));
    expect(launch.env).toEqual({ MCP_TOOL_TIMEOUT: '600000' });
    const fuse = launch.codex!.mcpServers!.fuse;
    expect(fuse.command).toBe(process.execPath);
    expect(fuse.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(JSON.stringify(fuse)).not.toContain('secret-token');
    const [bootstrap] = fuse.args;
    expect(bootstrap.endsWith(join('prompts', 'conv-1', 'mcp-bootstrap.cjs'))).toBe(true);
    if (process.platform !== 'win32') expect(statSync(bootstrap).mode & 0o777).toBe(0o600);
    const text = readFileSync(bootstrap, 'utf8');
    expect(text).toContain('"FUSE_API_TOKEN":"secret-token"');
    expect(text).toContain('"FUSE_API_URL":"http://127.0.0.1:4321"');
    expect(text).toContain('mcp-server.js');
    expect(launch.codex!.developerInstructions).toContain('formalization');
  });

  it('writes a bootstrap that loads the server with the private environment applied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuse-bootstrap-'));
    dirs.push(dir);
    const server = join(dir, 'server.mjs');
    writeFileSync(server, 'console.log(JSON.stringify({ token: process.env.FUSE_API_TOKEN, url: process.env.FUSE_API_URL }));\n');
    const bootstrap = join(dir, 'mcp-bootstrap.cjs');
    writeFileSync(bootstrap, codexMcpBootstrap(server, { FUSE_API_TOKEN: 'tok', FUSE_API_URL: 'http://127.0.0.1:1' }));
    const output = execFileSync(process.execPath, [bootstrap], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    expect(JSON.parse(output.trim())).toEqual({ token: 'tok', url: 'http://127.0.0.1:1' });
  });

  it('gives Claude the MCP config through a private file', () => {
    const launch = buildThreadLaunch(input('claude'));
    expect(launch.env).toEqual({ MCP_TOOL_TIMEOUT: '600000' });
    expect(launch.claude!.mcpConfigJson).toBeUndefined();
    const file = launch.claude!.mcpConfigFile!;
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const config = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers: { fuse: { env: Record<string, string>; args: string[] } } };
    expect(config.mcpServers.fuse.env.FUSE_API_TOKEN).toBe('secret-token');
    expect(config.mcpServers.fuse.args).toEqual(['/app/out/main/mcp-server.js']);
  });
});
