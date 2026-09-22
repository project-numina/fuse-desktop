/**
 * Builds the `fuse` MCP server object. Kept separate from the stdio entry so
 * tests can connect it to an in-memory transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FuseApiClient } from './client';
import type { FuseEnv } from './env';
import { registerFuseTools, type FuseToolDeps } from './tools';

export const SERVER_NAME = 'fuse';
export const SERVER_VERSION = '0.1.0';

export interface CreateServerOptions {
  env: FuseEnv;
  client?: FuseApiClient;
  fetch?: typeof fetch;
  readFile?: FuseToolDeps['readFile'];
}

export function createFuseServer(options: CreateServerOptions): McpServer {
  const client = options.client ?? new FuseApiClient({ baseUrl: options.env.apiUrl, token: options.env.apiToken, fetch: options.fetch });
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Tools of the Fuse desktop app for the blueprint the agent is working on: Lean language-server queries (goals, hover, diagnostics), builds with structured diagnostics, Mathlib search via loogle, and the blueprint metadata store (summary, declarations, status with .tex tag sync, validation, refresh).',
    },
  );
  registerFuseTools(server, { client, env: options.env, readFile: options.readFile });
  return server;
}
