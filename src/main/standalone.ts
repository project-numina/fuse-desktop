/**
 * Headless entry: runs the loopback backend and serves the built renderer
 * without Electron. Used by the integration tests and the screenshot
 * harness (and handy for driving the API with curl).
 *
 *   node out/main/standalone.js --data <dir> [--port 8765] [--token t]
 *        [--renderer out/renderer] [--register <folder>]...
 *
 * Prints one JSON line with {baseUrl, token, entryUrl} once listening.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { acquireInstanceLock, checkPort } from './instance-lock.mjs';
import { parseStandaloneArgs } from './launch-options';
import { stopModelProbes } from './agents/models';
import { fileURLToPath } from 'node:url';
import { appPaths } from './paths';
import { startLocalServer } from './server/app';
import type { AppContext } from './server/context';
import { SseRooms } from './server/sse';
import { SettingsStore } from './settings';
import { extendPathFromLoginShell } from './shell-path';
import { Registry } from './store/registry';

const bundleDir = fileURLToPath(new URL('.', import.meta.url));
/** Upper bound for ending sessions, stopping Lean and closing the server on SIGINT/SIGTERM. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const args = parseStandaloneArgs(process.argv.slice(2), join(bundleDir, '../renderer'));
  await acquireInstanceLock();
  if (args.port) await checkPort(args.port);
  await extendPathFromLoginShell();
  mkdirSync(args.data, { recursive: true });
  const paths = appPaths(args.data);
  const registry = new Registry(paths);
  const ctx: AppContext = {
    paths,
    registry,
    settings: new SettingsStore(join(args.data, 'settings.json')),
    blueprintRooms: new SseRooms(() => ({ overflowMessage: 'Blueprint event stream fell behind. Reconnect to refresh.' })),
    sessionRooms: new SseRooms(() => ({ overflowMessage: 'Session event stream fell behind. Reconnect to refresh.' })),
    resourcesDir: join(bundleDir, '../../resources'),
    server: null,
    services: {},
  };
  for (const folder of args.register) registry.addRepository(folder);
  const server = await startLocalServer(ctx, { rendererDir: args.renderer, port: args.port, token: args.token ?? undefined });
  ctx.server = { baseUrl: server.baseUrl, token: server.token };
  process.stdout.write(`${JSON.stringify({ baseUrl: server.baseUrl, token: server.token, entryUrl: server.entryUrl('/') })}\n`);
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // A stuck CLI or language server must not keep a harness hanging forever.
    const deadline = setTimeout(() => {
      console.error(`[fuse] shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms; exiting`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    let code = 0;
    try {
      registry.flushSync();
      const stop = ctx.services.shutdown as (() => Promise<void>) | undefined;
      await stop?.();
      await stopModelProbes();
      await server.close();
    } catch (error) {
      console.error('[fuse] shutdown failed:', error);
      code = 1;
    }
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGHUP', () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
