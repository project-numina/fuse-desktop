/**
 * GUI applications on macOS (and some Linux launchers) start with a minimal
 * PATH that lacks Homebrew, nvm, pnpm and friends, so `claude` and `codex`
 * look missing even though they work in a terminal. Ask the user's login
 * shell for its PATH once and merge it into ours.
 */

import { execFile } from 'node:child_process';

const MARKER = '__FUSE_PATH__';

export function parseShellPathOutput(output: string): string | null {
  const start = output.indexOf(MARKER);
  if (start < 0) return null;
  const rest = output.slice(start + MARKER.length);
  const end = rest.indexOf(MARKER);
  if (end < 0) return null;
  const value = rest.slice(0, end).trim();
  return value || null;
}

/** Merge two PATH strings, keeping order and dropping duplicates. */
export function mergePaths(primary: string, secondary: string, delimiter = ':'): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...primary.split(delimiter), ...secondary.split(delimiter)]) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }
  return merged.join(delimiter);
}

function loginShellPath(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    // -l loads the login profile (where PATH is usually set), -i the rc file
    // (where version managers such as nvm hook in).
    const child = execFile(
      shell,
      ['-ilc', `echo "${MARKER}$PATH${MARKER}"`],
      { timeout: 8_000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' }, windowsHide: true },
      (error, stdout) => resolve(error ? null : parseShellPathOutput(stdout)),
    );
    child.stdin?.end();
  });
}

/**
 * Extend `process.env.PATH` with the login shell's PATH. Safe to call more
 * than once; a shell that fails or hangs leaves the environment untouched.
 */
export async function extendPathFromLoginShell(): Promise<string | null> {
  if (process.platform === 'win32') return null;
  const shell = process.env.SHELL || '/bin/bash';
  const shellPath = await loginShellPath(shell);
  if (!shellPath) return null;
  process.env.PATH = mergePaths(shellPath, process.env.PATH ?? '');
  return process.env.PATH;
}
