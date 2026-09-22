/**
 * Provisioning a project's pinned Lean toolchain through elan before any
 * `lake` call, so the first build does not stall on elan's interactive
 * auto-install and a missing elan surfaces as one clear error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AsyncLock } from './async';
import { elanHome, leanProcessEnv, leanToolchainAvailable, runToolCollect } from './process';
import type { LeanBuildSettings } from './settings';

export const TOOLCHAIN_FILENAME = 'lean-toolchain';
const VALID_TOOLCHAIN_SPEC = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/;
export const UNVERSIONED_TOOLCHAIN_SLUG = 'unversioned';
export const ELAN_INSTALL_URL = 'https://leanprover-community.github.io/get_started.html';

export type ToolchainReporter = (phase: 'installing_toolchain', message: string) => void;

/** A validated, trimmed spec (no whitespace or shell metacharacters), else null. */
export function parseToolchainSpec(raw: string): string | null {
  const spec = raw.trim();
  return spec && VALID_TOOLCHAIN_SPEC.test(spec) ? spec : null;
}

export function readToolchainSpec(projectRoot: string): string | null {
  try {
    return parseToolchainSpec(readFileSync(join(projectRoot, TOOLCHAIN_FILENAME), 'utf8'));
  } catch {
    return null;
  }
}

/** `leanprover/lean4:v4.30.0-rc2` → `leanprover-lean4-v4.30.0-rc2` (filesystem-safe). */
export function slugifyToolchain(raw: string): string {
  const slug = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || UNVERSIONED_TOOLCHAIN_SLUG;
}

export function readToolchainSlug(projectRoot: string): string {
  try {
    return slugifyToolchain(readFileSync(join(projectRoot, TOOLCHAIN_FILENAME), 'utf8'));
  } catch {
    return UNVERSIONED_TOOLCHAIN_SLUG;
  }
}

export class LeanToolchainMissingError extends Error {
  constructor() {
    super(`Lean toolchain manager (elan) not found. Install it from ${ELAN_INSTALL_URL} and restart Fuse.`);
    this.name = 'LeanToolchainMissingError';
  }
}

/** Process-local memo of specs known to be installed, plus per-spec locks. */
class ToolchainInstallState {
  readonly locks = new Map<string, AsyncLock>();
  readonly installedSpecs = new Set<string>();

  lockFor(spec: string): AsyncLock {
    let lock = this.locks.get(spec);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(spec, lock);
    }
    return lock;
  }

  reset(): void {
    this.locks.clear();
    this.installedSpecs.clear();
  }
}

export const toolchainInstallState = new ToolchainInstallState();

export interface EnsureToolchainOptions {
  settings: LeanBuildSettings;
  reporter?: ToolchainReporter;
  signal?: AbortSignal;
  /** Test seam for the elan invocation. */
  runElan?: (args: string[]) => Promise<{ exitCode: number | null; output: string }>;
  /** Test seam for elan's presence. */
  elanPresent?: () => boolean;
}

function defaultRunElan(settings: LeanBuildSettings, signal?: AbortSignal) {
  return (args: string[]) =>
    runToolCollect('elan', args, {
      cwd: join(elanHome(), 'bin'),
      env: leanProcessEnv(settings),
      timeoutMs: settings.toolchainInstallTimeoutMs,
      signal,
    });
}

/**
 * Install the project's pinned toolchain if elan does not have it. No-op
 * without a pin. When elan is absent but `lake` is on PATH we only warn
 * (a system Lean install); when neither exists the build cannot proceed.
 */
export async function ensureToolchainInstalled(projectRoot: string, options: EnsureToolchainOptions): Promise<void> {
  const spec = readToolchainSpec(projectRoot);
  if (spec === null || toolchainInstallState.installedSpecs.has(spec)) return;
  await toolchainInstallState.lockFor(spec).withLock(async () => {
    if (toolchainInstallState.installedSpecs.has(spec)) return;
    const elanPresent = options.elanPresent ?? (() => existsSync(join(elanHome(), 'bin', process.platform === 'win32' ? 'elan.exe' : 'elan')));
    if (!elanPresent()) {
      if (!leanToolchainAvailable()) throw new LeanToolchainMissingError();
      console.warn(`[lean] elan not found under ${elanHome()}; skipping toolchain preflight`);
      return;
    }
    const runElan = options.runElan ?? defaultRunElan(options.settings, options.signal);
    const listed = await runElan(['toolchain', 'list']);
    if (listed.exitCode === 0) {
      const installed = new Set(
        listed.output
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/)[0])
          .filter(Boolean),
      );
      if (installed.has(spec)) {
        toolchainInstallState.installedSpecs.add(spec);
        return;
      }
    }
    options.reporter?.('installing_toolchain', `Installing Lean toolchain ${spec}...`);
    const install = await runElan(['toolchain', 'install', spec]);
    if (install.exitCode !== 0 && !install.output.includes('already installed')) {
      throw new Error(`Failed to install Lean toolchain ${spec} (elan exit ${install.exitCode}): ${install.output.trim() || '(no output)'}`);
    }
    toolchainInstallState.installedSpecs.add(spec);
  });
}
