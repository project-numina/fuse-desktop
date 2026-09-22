/**
 * Everything a route module may need, created once at startup and passed to
 * each `xxxRoutes(ctx)` factory. Services register themselves here so the
 * MCP server, the UI routes and the agent adapters share one instance of
 * each (one Lean language server per project, one event room per blueprint).
 */

import type { Registry } from '../store/registry';
import type { SettingsStore } from '../settings';
import type { AppPaths } from '../paths';
import type { SseRooms } from './sse';

export interface AppContext {
  paths: AppPaths;
  registry: Registry;
  settings: SettingsStore;
  /** Blueprint event rooms keyed "<owner>/<repo>/<blueprint>". */
  blueprintRooms: SseRooms;
  /** Session event rooms keyed by session id. */
  sessionRooms: SseRooms;
  /** Resources shipped with the app (prompts, MCP server script). */
  resourcesDir: string;
  /** Loopback base URL and token, available once the server is listening. */
  server: { baseUrl: string; token: string } | null;
  /**
   * Service slots filled in by the modules that own them. Typed loosely here
   * so route modules can be developed independently; each module narrows.
   */
  services: Record<string, unknown>;
}
