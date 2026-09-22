/**
 * Launch environment of the `fuse` MCP server. The app spawns the server per
 * conversation and passes everything it needs through environment variables
 * (the CLIs forward the `env` block of their MCP configuration verbatim):
 *
 *   FUSE_API_URL       loopback base URL of the app's HTTP backend
 *   FUSE_API_TOKEN     per-launch bearer token for that backend
 *   FUSE_OWNER         route owner segment of the repository
 *   FUSE_REPO          route repo segment of the repository
 *   FUSE_BLUEPRINT     blueprint (workspace) id
 *   FUSE_REPO_PATH     absolute path of the repository folder
 *   FUSE_PROJECT_ROOT  absolute path of the Lean project root (defaults to FUSE_REPO_PATH)
 */

import { resolve } from 'node:path';

export interface FuseEnv {
  apiUrl: string;
  apiToken: string;
  owner: string;
  repo: string;
  blueprint: string;
  repoPath: string;
  projectRoot: string;
}

const REQUIRED = ['FUSE_API_URL', 'FUSE_API_TOKEN', 'FUSE_OWNER', 'FUSE_REPO', 'FUSE_BLUEPRINT'] as const;

export function readFuseEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): FuseEnv {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`fuse MCP server: missing environment variable(s) ${missing.join(', ')}`);
  }
  // Either root may be omitted: the common layout has the Lean project at the
  // repository root, and a missing pair falls back to the CLI's working
  // directory, which the app sets to the repository root.
  const repoRaw = env.FUSE_REPO_PATH?.trim() || env.FUSE_PROJECT_ROOT?.trim() || cwd;
  const projectRaw = env.FUSE_PROJECT_ROOT?.trim() || repoRaw;
  return {
    apiUrl: env.FUSE_API_URL!.trim().replace(/\/+$/, ''),
    apiToken: env.FUSE_API_TOKEN!.trim(),
    owner: env.FUSE_OWNER!.trim(),
    repo: env.FUSE_REPO!.trim(),
    blueprint: env.FUSE_BLUEPRINT!.trim(),
    repoPath: resolve(repoRaw),
    projectRoot: resolve(projectRaw),
  };
}
