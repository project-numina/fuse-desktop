/**
 * End-to-end check of the bundled stdio server (`out/main/mcp-server.js`):
 * it must start under plain Node and under Electron's Node mode, answer
 * `initialize`, list its tools, and reject a tool call cleanly when the app
 * is unreachable. Requires a prior `npm run build`; skipped otherwise.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '@mcp/tools';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const bundle = join(appRoot, 'out', 'main', 'mcp-server.js');
const built = existsSync(bundle);

function electronBinary(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const path = require('electron') as unknown;
    return typeof path === 'string' && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const env = {
  FUSE_API_URL: 'http://127.0.0.1:9', // discard port: nothing listens, so tool calls fail fast
  FUSE_API_TOKEN: 'token',
  FUSE_OWNER: 'local',
  FUSE_REPO: 'repo',
  FUSE_BLUEPRINT: 'bp',
  FUSE_REPO_PATH: appRoot,
  FUSE_PROJECT_ROOT: appRoot,
};

async function exercise(command: string, args: string[], extraEnv: Record<string, string> = {}): Promise<void> {
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...(process.env as Record<string, string>), ...env, ...extraEnv },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'server-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    expect(client.getServerVersion()).toEqual({ name: 'fuse', version: '0.1.0' });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    const result = await client.callTool({ name: 'blueprint_get_summary', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('');
    expect(text).toMatch(/^Error executing tool blueprint_get_summary: Could not reach the Fuse app/);
  } finally {
    await client.close();
  }
}

describe('built mcp-server bundle', () => {
  it.skipIf(!built)('answers initialize and tools/list over stdio under plain Node', async () => {
    await exercise(process.execPath, [bundle]);
  }, 30_000);

  const electron = electronBinary();
  it.skipIf(!built || !electron)('runs under Electron in Node mode (ELECTRON_RUN_AS_NODE=1)', async () => {
    await exercise(electron!, [bundle], { ELECTRON_RUN_AS_NODE: '1' });
  }, 60_000);

  it.skipIf(!built)('exits with a clear message when the launch environment is incomplete', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const stripped = { ...process.env };
    for (const key of Object.keys(env)) delete stripped[key];
    const failure = (await run(process.execPath, [bundle], { env: stripped, windowsHide: true }).then(
      () => null,
      (error: { code?: number; stderr?: string }) => error,
    )) as { code?: number; stderr?: string } | null;
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('missing environment variable(s) FUSE_API_URL');
  }, 30_000);
});
