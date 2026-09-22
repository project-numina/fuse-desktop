import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';
import { ensureToolchainInstalled, readToolchainSlug, readToolchainSpec, slugifyToolchain, toolchainInstallState } from '@main/services/lean/toolchain';

const SPEC = 'leanprover/lean4:v4.27.0-rc1';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fuse-toolchain-'));
  toolchainInstallState.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  toolchainInstallState.reset();
});

describe('readToolchainSpec', () => {
  it('reads and trims a pinned spec', () => {
    writeFileSync(join(root, 'lean-toolchain'), `${SPEC}\n`);
    expect(readToolchainSpec(root)).toBe(SPEC);
  });

  it('returns null for a missing or empty file', () => {
    expect(readToolchainSpec(root)).toBeNull();
    writeFileSync(join(root, 'lean-toolchain'), '  \n');
    expect(readToolchainSpec(root)).toBeNull();
  });

  it.each(['bad spec', 'v1;rm -rf /', '$(whoami)'])('rejects malformed spec %s', (spec) => {
    writeFileSync(join(root, 'lean-toolchain'), spec);
    expect(readToolchainSpec(root)).toBeNull();
  });
});

describe('toolchain slugs', () => {
  it('slugifies for filesystem use with an unversioned fallback', () => {
    expect(slugifyToolchain('leanprover/lean4:v4.30.0-rc2\n')).toBe('leanprover-lean4-v4.30.0-rc2');
    expect(slugifyToolchain('   ')).toBe('unversioned');
    expect(readToolchainSlug(root)).toBe('unversioned');
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    expect(readToolchainSlug(root)).toBe('leanprover-lean4-v4.27.0-rc1');
  });
});

describe('ensureToolchainInstalled', () => {
  function fakeElan(responses: Array<{ exitCode: number; output: string }>) {
    const calls: string[][] = [];
    const runElan = async (args: string[]): Promise<{ exitCode: number; output: string }> => {
      calls.push(args);
      const next = responses.shift();
      if (!next) throw new Error('unexpected elan call');
      return next;
    };
    return { calls, runElan };
  }

  it('is a no-op without a pinned toolchain', async () => {
    const { calls, runElan } = fakeElan([]);
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true });
    expect(calls).toEqual([]);
  });

  it('installs a missing toolchain and reports the phase', async () => {
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    const { calls, runElan } = fakeElan([{ exitCode: 0, output: '' }, { exitCode: 0, output: '' }]);
    const phases: string[] = [];
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true, reporter: (phase, message) => phases.push(`${phase}:${message}`) });
    expect(calls).toEqual([['toolchain', 'list'], ['toolchain', 'install', SPEC]]);
    expect(phases).toEqual([`installing_toolchain:Installing Lean toolchain ${SPEC}...`]);
  });

  it('skips the install when the toolchain is listed', async () => {
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    const { calls, runElan } = fakeElan([{ exitCode: 0, output: `${SPEC}\nleanprover/lean4:stable (default)\n` }]);
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true });
    expect(calls).toHaveLength(1);
  });

  it('tolerates the already-installed race', async () => {
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    const { runElan } = fakeElan([{ exitCode: 0, output: '' }, { exitCode: 1, output: `error: '${SPEC}' is already installed` }]);
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true });
    expect(toolchainInstallState.installedSpecs.has(SPEC)).toBe(true);
  });

  it('caches a provisioned spec for the process', async () => {
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    const { calls, runElan } = fakeElan([{ exitCode: 0, output: '' }, { exitCode: 0, output: '' }]);
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true });
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true });
    expect(calls).toHaveLength(2);
  });

  it('raises on a failed install', async () => {
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    const { runElan } = fakeElan([{ exitCode: 0, output: '' }, { exitCode: 1, output: 'network down' }]);
    await expect(ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => true })).rejects.toThrow(/Failed to install Lean toolchain .* network down/);
    expect(toolchainInstallState.installedSpecs.has(SPEC)).toBe(false);
  });

  it('skips the preflight without elan when lake is otherwise available', async () => {
    writeFileSync(join(root, 'lean-toolchain'), SPEC);
    const { calls, runElan } = fakeElan([]);
    const elan = join(root, 'elan');
    mkdirSync(join(elan, 'bin'), { recursive: true });
    writeFileSync(join(elan, 'bin', process.platform === 'win32' ? 'lake.exe' : 'lake'), '');
    vi.stubEnv('ELAN_HOME', elan);
    await ensureToolchainInstalled(root, { settings: DEFAULT_LEAN_SETTINGS, runElan, elanPresent: () => false });
    expect(calls).toEqual([]);
  });
});
