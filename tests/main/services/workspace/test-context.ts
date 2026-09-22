/**
 * Test helper: a real AppContext over a temporary data directory (JSON
 * registries, settings, SSE rooms) with the sources service registered.
 * Kept next to the tests so route and service tests share one setup.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appPaths } from '@main/paths';
import type { AppContext } from '@main/server/context';
import { SseRooms } from '@main/server/sse';
import { SettingsStore } from '@main/settings';
import { Registry } from '@main/store/registry';
import { registerSourceService } from '@main/services/sources';

export interface TestContext {
  ctx: AppContext;
  root: string;
  cleanup(): void;
}

export function createTestContext(): TestContext {
  const root = mkdtempSync(join(tmpdir(), 'fuse-ctx-'));
  const paths = appPaths(join(root, 'userData'));
  const ctx: AppContext = {
    paths,
    registry: new Registry(paths),
    settings: new SettingsStore(join(root, 'userData', 'settings.json')),
    blueprintRooms: new SseRooms(() => ({})),
    sessionRooms: new SseRooms(() => ({})),
    resourcesDir: join(root, 'resources'),
    server: null,
    services: {},
  };
  registerSourceService(ctx);
  return {
    ctx,
    root,
    cleanup: () => {
      ctx.registry.flushSync();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
