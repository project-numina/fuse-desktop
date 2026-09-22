/**
 * Safe execution of git commands (the desktop equivalent of the web
 * backend's `run_git`).
 *
 * Every call carries the same hardening prefix the web uses for process-local
 * configuration and the same error shape (`git <sub> failed (exit N): ...`)
 * with credentials redacted. Unlike the hosted sandbox we deliberately keep
 * the user's global config, credential helper and hooks: commits must carry
 * their identity and pushes must use their credentials.
 */

import { execFile } from 'node:child_process';

export const DEFAULT_GIT_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** URL with authority credentials, shared by redaction and leak detection. */
export const CREDENTIALED_URL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^:/\s]*:)[^@\s]+@/gi;
const BASIC_AUTH_PATTERN = /(authorization:\s*basic\s+)[A-Za-z0-9+/=]+/gi;

const HARDENING_PREFIX = ['-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', '-c', 'diff.trustExitCode=false'];

export interface GitRunOptions {
  cwd: string;
  /** Extra `-c key=value` configuration; values are redacted from errors. */
  configs?: Record<string, string>;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Raised when git exits non-zero, times out or cannot start. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export function redactGitOutput(output: string, configs?: Record<string, string>): string {
  let sanitized = output.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
  sanitized = sanitized.replace(CREDENTIALED_URL_PATTERN, '$1***@');
  sanitized = sanitized.replace(BASIC_AUTH_PATTERN, '$1***');
  for (const value of Object.values(configs ?? {})) {
    if (value) sanitized = sanitized.split(value).join('***');
  }
  return sanitized;
}

/** The git subcommand after any leading `-c key=value` pairs. */
function subcommandOf(args: readonly string[]): { name: string; index: number } {
  let index = 0;
  while (index < args.length && args[index] === '-c') index += 2;
  return { name: args[index] ?? '', index };
}

/** `git diff` must never run external diff or textconv programs. */
function hardenArguments(args: readonly string[]): string[] {
  const { name, index } = subcommandOf(args);
  if (name !== 'diff') return [...args];
  const hardened = [...args];
  const extras = ['--no-ext-diff', '--no-textconv'].filter((flag) => !hardened.includes(flag));
  hardened.splice(index + 1, 0, ...extras);
  return hardened;
}

function validateArguments(args: readonly string[]): void {
  if (args.length === 0) throw new TypeError('git arguments must not be empty');
  for (const argument of args) {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      throw new TypeError('git arguments must be strings without NUL');
    }
  }
}

/**
 * Run git in `cwd` and return stdout with only its trailing line terminators
 * removed (leading whitespace in porcelain output is significant).
 */
export function runGit(args: readonly string[], options: GitRunOptions): Promise<string> {
  validateArguments(args);
  const configArgs: string[] = [];
  for (const [key, value] of Object.entries(options.configs ?? {})) {
    if (!key || key.includes('\0') || value.includes('\0')) throw new TypeError('git configs must be NUL-free');
    configArgs.push('-c', `${key}=${value}`);
  }
  const commandArgs = [...HARDENING_PREFIX, ...configArgs, ...hardenArguments(args)];
  const { name } = subcommandOf(args);
  const timeout = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.env ?? {}), GIT_TERMINAL_PROMPT: '0' };
  if (options.configs && Object.keys(options.configs).length > 0) {
    // Trace variables would print the credential-bearing config values.
    for (const key of Object.keys(env)) {
      if (key.startsWith('GIT_TRACE') || key === 'GIT_CURL_VERBOSE') delete env[key];
    }
  }
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      commandArgs,
      { cwd: options.cwd, env, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, timeout, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error) {
          const failure = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string };
          if (failure.killed && failure.signal === 'SIGTERM') {
            reject(new GitError(`git ${name} timed out after ${Math.round(timeout / 1000)}s`));
            return;
          }
          if (typeof failure.code === 'string') {
            reject(new GitError(`git ${name} could not start: ${failure.message}`));
            return;
          }
          const raw = (stderr.length > 0 ? stderr : stdout).toString('utf8').trim() || '(no output)';
          const exit = typeof failure.code === 'number' ? failure.code : null;
          reject(new GitError(`git ${name} failed (exit ${exit ?? '?'}): ${redactGitOutput(raw, options.configs)}`, exit));
          return;
        }
        resolve(stdout.toString('utf8').replace(/[\r\n]+$/, ''));
      },
    );
  });
}

/** Run git and return null instead of throwing (read-only probes). */
export async function tryGit(args: readonly string[], options: GitRunOptions): Promise<string | null> {
  try {
    return await runGit(args, options);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}
