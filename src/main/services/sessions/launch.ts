/**
 * How a session's CLI process is launched: working directory, environment
 * for the bundled `fuse` MCP server, and the provider-specific options that
 * reproduce the hosted backend's Claude Agent SDK options (system prompt,
 * plugin dir with the role files, MCP config, tool allow/deny lists,
 * max turns) or their Codex equivalents.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ThreadLaunch } from '../../agents/types';
import type { AppPaths } from '../../paths';
import type { OpenProject } from '../types';
import { renderSystemPrompt, type PromptPlacement } from './prompts';

/** Harness tools that would resume the agent outside Fuse's turn orchestration (or stall it). */
export const DISALLOWED_HARNESS_TOOLS = ['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete', 'AskUserQuestion'];
export const ALLOWED_TOOL_PATTERNS = ['mcp__fuse', 'Task'];
export const AGENT_MAX_TURNS = 200;
/** Long enough for a full `lake build` through the MCP server; the web's 3 h is for its remote provers. */
export const MCP_TOOL_TIMEOUT_MS = 600_000;

export interface LaunchInput {
  conversationId: string;
  project: OpenProject;
  paths: AppPaths;
  resourcesDir: string;
  server: { baseUrl: string; token: string } | null;
  /** Explicit CLI path from settings, '' for PATH lookup. */
  executable: string;
  providerThreadId: string | null;
  /** Native sessions keep the directory they were created in. */
  workingDirectory?: string;
  /** The MCP server script (out/main/mcp-server.js). */
  mcpServerPath: string;
  leanModule: string | null;
}

/** Locate the bundled MCP server next to (or one level above) this module. */
export function defaultMcpServerPath(): string {
  const candidates = [new URL('./mcp-server.js', import.meta.url), new URL('../mcp-server.js', import.meta.url)];
  for (const candidate of candidates) {
    try {
      // Inside a packaged app the bundle lives in app.asar, which the CLIs
      // cannot read; electron-builder unpacks the server next to it.
      const path = fileURLToPath(candidate).replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
      if (existsSync(path)) return path;
    } catch {
      /* not a file URL (tests) */
    }
  }
  return fileURLToPath(candidates[0]);
}

/** Absolute path of the blueprint entrypoint (`blueprint/src/content.tex` when not chosen yet). */
export function blueprintTexPath(project: OpenProject): string {
  if (project.blueprintFile) return resolve(project.clonePath, project.blueprintFile);
  return join(project.projectRoot, 'blueprint', 'src', 'content.tex');
}

/**
 * Environment the MCP server reads to reach this app. It carries the loopback
 * bearer token, so it goes to the server process only (through the Claude
 * MCP config file or the Codex bootstrap file), never into the CLI's own
 * environment, which every shell command the agent runs inherits.
 */
export function fuseEnvironment(input: LaunchInput): Record<string, string> {
  const { project } = input;
  return {
    FUSE_API_URL: input.server?.baseUrl ?? '',
    FUSE_API_TOKEN: input.server?.token ?? '',
    FUSE_OWNER: project.repository.owner,
    FUSE_REPO: project.repository.name,
    FUSE_BLUEPRINT: project.blueprint.id,
    FUSE_PROJECT_ROOT: project.projectRoot,
    FUSE_REPO_PATH: project.clonePath,
    FUSE_CONVERSATION_ID: input.conversationId,
  };
}

export function promptPlacement(input: LaunchInput): PromptPlacement {
  const { project } = input;
  return {
    repoLabel: `${project.repository.owner}/${project.repository.name}`,
    repoRoot: project.clonePath,
    workingDirectory: input.workingDirectory,
    projectRoot: project.projectRoot,
    projectSubdir: project.projectSubdir,
    blueprintName: project.blueprint.id,
    blueprintTexPath: blueprintTexPath(project),
    leanModule: input.leanModule,
  };
}

/** Write a per-conversation launch file readable by this user only (the token lives in it). */
function writePrivateFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows: ACLs of the user's app-data folder apply */
  }
}

/**
 * The Codex MCP entry: a CommonJS bootstrap that sets the server's private
 * environment and loads the bundled server. Codex only takes MCP settings as
 * `-c` command-line overrides, which every local process can read, so the
 * token is kept in this file instead.
 */
export function codexMcpBootstrap(mcpServerPath: string, env: Record<string, string>): string {
  return [
    '// Written by Fuse Desktop: starts the fuse MCP server for one conversation.',
    "'use strict';",
    `Object.assign(process.env, ${JSON.stringify(env)});`,
    `import(${JSON.stringify(pathToFileURL(mcpServerPath).href)}).catch((error) => {`,
    '  console.error(error);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

export function buildThreadLaunch(input: LaunchInput): ThreadLaunch {
  const { project } = input;
  const config = project.blueprint.agent;
  const env = fuseEnvironment(input);
  const promptsDir = join(input.resourcesDir, 'prompts');
  const systemPrompt = renderSystemPrompt({ promptsDir, provider: config.provider }, promptPlacement(input));
  const mcpEnv = { ELECTRON_RUN_AS_NODE: '1', ...env };
  const launchDir = join(input.paths.dataDir, 'prompts', input.conversationId);
  const launch: ThreadLaunch = {
    threadId: input.conversationId,
    repoPath: input.workingDirectory ?? project.clonePath,
    config,
    providerThreadId: input.providerThreadId,
    executable: input.executable,
    env: { MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
  };
  if (config.provider === 'claude') {
    // The prompt is ~30 KB: too long for a Windows command line, so it
    // travels through a file under the app's data directory.
    const promptFile = join(launchDir, 'system.md');
    mkdirSync(dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, systemPrompt);
    // So does the MCP config: its env holds the loopback token.
    const mcpConfigFile = join(launchDir, 'mcp.json');
    writePrivateFile(
      mcpConfigFile,
      JSON.stringify({
        mcpServers: {
          fuse: { type: 'stdio', command: process.execPath, args: [input.mcpServerPath], env: mcpEnv },
        },
      }),
    );
    const pluginDir = join(promptsDir, 'blueprint');
    launch.claude = {
      systemPromptFile: promptFile,
      ...(existsSync(pluginDir) ? { pluginDir } : {}),
      mcpConfigFile,
      // The blueprint lives outside the Lean project when a subdir is selected.
      addDirs: project.projectSubdir ? [project.clonePath] : [],
      allowedTools: ALLOWED_TOOL_PATTERNS,
      disallowedTools: DISALLOWED_HARNESS_TOOLS,
      maxTurns: AGENT_MAX_TURNS,
    };
  } else {
    const bootstrap = join(launchDir, 'mcp-bootstrap.cjs');
    writePrivateFile(bootstrap, codexMcpBootstrap(input.mcpServerPath, mcpEnv));
    launch.codex = {
      developerInstructions: systemPrompt,
      mcpServers: { fuse: { command: process.execPath, args: [bootstrap], env: { ELECTRON_RUN_AS_NODE: '1' } } },
    };
  }
  return launch;
}

/**
 * Best-effort Lean module name for the prompt: the first `[[lean_lib]]` of
 * lakefile.toml, else the first `lean_lib` of lakefile.lean, else null.
 */
export function inferLeanModule(projectRoot: string): string | null {
  try {
    const toml = join(projectRoot, 'lakefile.toml');
    if (existsSync(toml)) {
      const text = readFileSync(toml, 'utf8');
      const match = /\[\[lean_lib\]\][^[]*?name\s*=\s*"([^"]+)"/m.exec(text);
      if (match) return match[1];
    }
    const lean = join(projectRoot, 'lakefile.lean');
    if (existsSync(lean)) {
      const text = readFileSync(lean, 'utf8');
      const match = /lean_lib\s+«?([A-Za-z_][\w.']*)»?/m.exec(text);
      if (match) return match[1];
    }
  } catch {
    /* unreadable lakefile: the prompt says so */
  }
  return null;
}
