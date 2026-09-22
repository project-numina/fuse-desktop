/**
 * Entry point of the `fuse` MCP server the CLIs connect to (stdio). It is a
 * thin client of the app's loopback HTTP API (base URL and token arrive in
 * FUSE_API_URL / FUSE_API_TOKEN, the project in FUSE_OWNER / FUSE_REPO /
 * FUSE_BLUEPRINT / FUSE_REPO_PATH / FUSE_PROJECT_ROOT), so the agent and the
 * UI share one Lean language server, one build queue and one blueprint model.
 *
 * Runs under plain Node and under Electron's Node mode
 * (`ELECTRON_RUN_AS_NODE=1 <electron> out/main/mcp-server.js`). stdout is the
 * protocol channel: nothing but MCP frames may be written to it, so all
 * logging goes to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFuseServer } from './create-server';
import { readFuseEnv } from './env';

async function main(): Promise<void> {
  const env = readFuseEnv();
  const server = createFuseServer({ env });
  const transport = new StdioServerTransport();
  // The CLI ends the conversation by closing our stdin; exit promptly instead
  // of lingering as an orphan next to the app.
  process.stdin.on('end', () => {
    void server.close().finally(() => process.exit(0));
  });
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
