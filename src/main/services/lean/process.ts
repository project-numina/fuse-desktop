/**
 * Spawning and killing Lean toolchain processes. `lake build` and `lake serve`
 * fork multi-gigabyte `lean` workers, so every kill has to reach the whole
 * tree: on POSIX children start in their own process group (`detached`) and
 * we signal the group; on Windows `taskkill /T` walks the tree for us.
 */

import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnCli } from '../../agents/spawn';
import type { LeanBuildSettings } from './settings';

const IS_WINDOWS = process.platform === 'win32';

/**
 * The key `env` stores `name` under. Windows environment blocks are
 * case-insensitive and the system spells the search path `Path`; a spread
 * copy of `process.env` keeps that casing (only the live proxy resolves
 * `PATH` to it), so writing the canonical spelling would add a second key —
 * and Node's spawn keeps just one of the two (the first in sort order),
 * handing the child `PATH=<elan>\bin` without the system PATH.
 */
export function envKey(env: NodeJS.ProcessEnv, name: string, windows = IS_WINDOWS): string {
  if (!windows || name in env) return name;
  const upper = name.toUpperCase();
  return Object.keys(env).find((key) => key.toUpperCase() === upper) ?? name;
}

/** `$ELAN_HOME`, else `~/.elan`. */
export function elanHome(env: NodeJS.ProcessEnv = process.env, windows = IS_WINDOWS): string {
  const configured = env[envKey(env, 'ELAN_HOME', windows)]?.trim();
  return configured || join(homedir(), '.elan');
}

function executableName(name: string): string {
  return IS_WINDOWS ? `${name}.exe` : name;
}

/**
 * Prefer the elan-managed binary so a GUI launch without the terminal's PATH
 * still finds `lake`; fall back to the bare name for PATH lookup. Returning
 * an `.exe` path on Windows also lets spawnCli skip the cmd.exe shim.
 */
export function leanToolPath(name: 'lake' | 'lean' | 'elan', env: NodeJS.ProcessEnv = process.env): string {
  const candidate = join(elanHome(env), 'bin', executableName(name));
  return existsSync(candidate) ? candidate : name;
}

/** Whether elan (or at least lake) is reachable; the build refuses early otherwise. */
export function leanToolchainAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (existsSync(join(elanHome(env), 'bin', executableName('lake')))) return true;
  const pathEntries = (env[envKey(env, 'PATH')] ?? '').split(delimiter).filter(Boolean);
  return pathEntries.some((entry) => existsSync(join(entry, executableName('lake'))));
}

export interface LeanEnvOptions {
  /** The environment to derive from (test seam; default `process.env`). */
  base?: NodeJS.ProcessEnv;
  /** Resolve keys case-insensitively as Windows does (test seam; default: the platform). */
  windows?: boolean;
}

/**
 * Environment for lake/lean subprocesses: the user's environment plus
 * `LEAN_NUM_THREADS`, `ELAN_HOME`, and elan's bin directory on PATH. Every
 * write goes to the key's existing spelling (see `envKey`) so the child
 * never receives two case-variants of one variable.
 */
export function leanProcessEnv(settings: LeanBuildSettings, extra: Record<string, string> = {}, options: LeanEnvOptions = {}): NodeJS.ProcessEnv {
  const windows = options.windows ?? IS_WINDOWS;
  const env: NodeJS.ProcessEnv = { ...(options.base ?? process.env) };
  const set = (name: string, value: string): void => {
    env[envKey(env, name, windows)] = value;
  };
  const home = elanHome(env, windows);
  const bin = join(home, 'bin');
  const entries = (env[envKey(env, 'PATH', windows)] ?? '').split(delimiter).filter(Boolean);
  if (!entries.includes(bin)) set('PATH', [bin, ...entries].join(delimiter));
  set('ELAN_HOME', home);
  set('LEAN_NUM_THREADS', String(settings.leanNumThreads));
  if (settings.lakeArtifactCache) set('LAKE_ARTIFACT_CACHE', 'true');
  for (const [key, value] of Object.entries(extra)) set(key, value);
  return env;
}

export interface SpawnLeanToolOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Spawn a Lean toolchain command in its own process group (POSIX). */
export function spawnLeanTool(tool: 'lake' | 'lean' | 'elan', args: string[], options: SpawnLeanToolOptions): ChildProcess {
  const executable = leanToolPath(tool, options.env);
  const stdio: Array<'pipe' | 'ignore'> = ['pipe', 'pipe', 'pipe'];
  const child = spawnCli(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio,
    // Own process group so timeouts and shutdown can kill lake and every
    // `lean` worker it forked. Windows has no groups; taskkill /T covers it.
    detached: !IS_WINDOWS,
  });
  return child;
}

export type TerminateReason = 'timeout' | 'cancelled' | 'shutdown';

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WINDOWS) {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/** Signal the whole tree right now without waiting (shutdown fast path). */
export function killProcessGroupNow(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  killGroup(child, signal);
}

/**
 * SIGTERM the tree, wait `timeoutMs`, then SIGKILL it. Resolves once the
 * root process has exited (or shortly after the kill on stubborn trees).
 */
export async function terminateProcessGroup(child: ChildProcess, reason: TerminateReason, timeoutMs = 5_000): Promise<void> {
  void reason;
  if (child.exitCode !== null || child.signalCode !== null) return;
  killGroup(child, 'SIGTERM');
  if (await waitForExit(child, timeoutMs)) return;
  killGroup(child, 'SIGKILL');
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone.
  }
  await waitForExit(child, 2_000);
}

/** Collect a process's stdout+stderr with a timeout; kills the tree on expiry. */
export async function runToolCollect(
  tool: 'lake' | 'lean' | 'elan',
  args: string[],
  options: SpawnLeanToolOptions & { timeoutMs: number; signal?: AbortSignal },
): Promise<{ exitCode: number | null; output: string }> {
  const child = spawnLeanTool(tool, args, options);
  const chunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stdin?.end();
  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateProcessGroup(child, 'timeout');
  }, options.timeoutMs);
  const onAbort = (): void => {
    aborted = true;
    void terminateProcessGroup(child, 'cancelled');
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
    });
    const output = Buffer.concat(chunks).toString('utf8');
    if (timedOut) throw new LakeTimeoutError(`${tool} ${args.join(' ')} timed out after ${options.timeoutMs / 1000}s`);
    if (aborted) {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    }
    return { exitCode, output };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export class LakeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LakeTimeoutError';
  }
}
