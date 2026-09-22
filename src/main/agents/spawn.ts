import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * Launching the Claude Code / Codex CLIs without a shell on every platform.
 *
 * npm installs Windows commands as `.cmd` shims, which Node can only run
 * through `cmd.exe`; under `shell: true` Node joins the arguments with spaces
 * and no quoting, so inline JSON, TOML strings and paths with spaces break.
 * Instead the shim is read and its target launched directly: a native
 * executable as is, a JavaScript entry through `node`. The Codex npm
 * wrapper (`@openai/codex/bin/codex.js`) is resolved one step further to the
 * platform binary it would spawn, so signals reach the CLI itself instead of
 * a wrapper that forwards only the first one (and none on Windows).
 */

export interface ResolvedCommand {
  file: string;
  args: string[];
  /** Extra environment the resolved launch needs (merged over the caller's). */
  env: Record<string, string>;
  /** Only set when the shim could not be resolved: a shell with pre-quoted args. */
  shell: boolean;
}

export interface ResolveOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  /** The Node-compatible binary to run JavaScript entries with (Electron in Node mode). */
  execPath?: string;
}

const CODEX_TARGETS: Record<string, string> = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'android-x64': 'x86_64-unknown-linux-musl',
  'android-arm64': 'aarch64-unknown-linux-musl',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

function isPathLike(command: string): boolean {
  return command.includes('/') || command.includes('\\') || isAbsolute(command);
}

/** Find a bare command on PATH the way the platform's shell would. */
export function findOnPath(command: string, options: ResolveOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathValue = env.PATH ?? env.Path ?? '';
  const separator = platform === 'win32' ? ';' : delimiter;
  const names = platform === 'win32' ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command] : [command];
  for (const dir of pathValue.split(separator)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        /* unreadable directory */
      }
    }
  }
  return null;
}

/** The npm `.cmd` shim's target (`%dp0%\node_modules\...`), or null when it is not an npm shim. */
export function cmdShimTarget(shimPath: string): string | null {
  let text: string;
  try {
    text = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const match = /"%dp0%\\([^"\r\n]+)"\s+%\*/i.exec(text) ?? /"%dp0%\\([^"\r\n]+)"/i.exec(text);
  if (!match) return null;
  return resolve(dirname(shimPath), match[1].replace(/\\/g, sep));
}

/** The native Codex binary behind the npm wrapper `@openai/codex/bin/codex.js`, when installed. */
export function codexNativeBinary(wrapperPath: string, options: ResolveOptions = {}): { file: string; packageRoot: string } | null {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const normalized = wrapperPath.replace(/\\/g, '/');
  if (!/\/@openai\/codex\/bin\/codex\.(?:c?js|mjs)$/i.test(normalized)) return null;
  const triple = CODEX_TARGETS[`${platform}-${arch}`];
  if (!triple) return null;
  const packageRoot = dirname(dirname(wrapperPath));
  const platformPackage = `codex-${platform}-${arch}`;
  const binary = platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [
    join(packageRoot, 'node_modules', '@openai', platformPackage, 'vendor', triple, 'bin', binary),
    join(dirname(packageRoot), platformPackage, 'vendor', triple, 'bin', binary),
    join(packageRoot, 'vendor', triple, 'bin', binary),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { file: candidate, packageRoot };
  }
  return null;
}

function nodeRunner(shimDir: string, options: ResolveOptions): { file: string; env: Record<string, string> } {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform === 'win32') {
    // Same lookup as the shim itself: node.exe next to it, else on PATH.
    const sibling = join(shimDir, 'node.exe');
    if (existsSync(sibling)) return { file: sibling, env: {} };
    const onPath = findOnPath('node', { platform, env });
    if (onPath && /\.exe$/i.test(onPath)) return { file: onPath, env: {} };
  }
  // The app's own binary runs JavaScript when Electron is told to be Node.
  return { file: options.execPath ?? process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/**
 * Turn `executable args` into something `spawn` can run without a shell.
 * Unknown commands are returned unchanged so the spawn error names them.
 */
export function resolveCliCommand(executable: string, args: readonly string[], options: ResolveOptions = {}): ResolvedCommand {
  const platform = options.platform ?? process.platform;
  const plain: ResolvedCommand = { file: executable, args: [...args], env: {}, shell: false };
  let file = executable;
  if (!isPathLike(file)) {
    const found = findOnPath(file, options);
    if (!found) return plain;
    file = found;
  }
  if (platform !== 'win32') {
    let real: string;
    try {
      real = realpathSync(file);
    } catch {
      return plain;
    }
    const native = codexNativeBinary(real, options);
    if (native) {
      return {
        file: native.file,
        args: [...args],
        env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: native.packageRoot },
        shell: false,
      };
    }
    return { ...plain, file };
  }
  const extension = extname(file).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return { ...plain, file };
  const target = cmdShimTarget(file);
  if (!target || !existsSync(target)) {
    // Not an npm shim: the only way to run it is through cmd.exe, quoted.
    return { file, args: args.map(quoteForCmd), env: {}, shell: true };
  }
  const targetExtension = extname(target).toLowerCase();
  if (targetExtension === '.exe') return { file: target, args: [...args], env: {}, shell: false };
  const native = codexNativeBinary(target, options);
  if (native) {
    return {
      file: native.file,
      args: [...args],
      env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: native.packageRoot },
      shell: false,
    };
  }
  const runner = nodeRunner(dirname(file), options);
  return { file: runner.file, args: [target, ...args], env: runner.env, shell: false };
}

/**
 * Quote one argument for `cmd.exe /c` followed by MSVCRT argv parsing (the
 * escaping `cross-spawn` uses): the argument is wrapped in double quotes,
 * inner quotes and the backslashes before them are escaped for the C
 * runtime, and cmd's own metacharacters are caret-escaped.
 */
export function quoteForCmd(arg: string): string {
  if (arg === '') return '""';
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
  escaped = escaped.replace(/(\\*)$/, '$1$1');
  escaped = `"${escaped}"`;
  return escaped.replace(/[()%!^"<>&|]/g, '^$&');
}

/**
 * Spawn a CLI in a way that works on every platform. The command is resolved
 * with `resolveCliCommand`, so arguments never meet a shell unless the
 * executable is an unrecognised Windows script (then they are quoted).
 */
export function spawnCli(
  executable: string,
  args: string[],
  options: Omit<SpawnOptions, 'shell'>,
): ChildProcessWithoutNullStreams {
  const resolved = resolveCliCommand(executable, args, { env: options.env ?? process.env });
  const env = Object.keys(resolved.env).length > 0 ? { ...(options.env ?? process.env), ...resolved.env } : options.env;
  return spawn(resolved.file, resolved.args, {
    ...options,
    ...(env ? { env } : {}),
    windowsHide: true,
    shell: resolved.shell,
  }) as ChildProcessWithoutNullStreams;
}

/**
 * Signal a CLI process. Windows has no signals: `ChildProcess.kill` there
 * terminates only the direct child and leaves what it spawned (the MCP
 * server, a native binary behind a wrapper) running, so the whole process
 * tree is ended with `taskkill` instead.
 */
export function killCli(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    child.kill(signal);
    return;
  }
  if (child.pid === undefined || child.exitCode !== null) return;
  const pid = child.pid;
  spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
}

/** Characters that are safe to pass through `cmd.exe` unquoted. */
const SHELL_SAFE = /^[A-Za-z0-9_./:@%+=,-]*$/;

/** True when every argument survives a Windows shell without quoting. */
export function argsAreShellSafe(args: readonly string[]): boolean {
  return args.every((arg) => SHELL_SAFE.test(arg) || /^[A-Za-z0-9_]+="[A-Za-z0-9_.-]+"$/.test(arg));
}
