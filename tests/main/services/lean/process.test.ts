import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFile, spawnCli } = vi.hoisted(() => ({ execFile: vi.fn(), spawnCli: vi.fn() }));

vi.mock('@main/agents/spawn', () => ({ spawnCli }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile };
});

import {
  elanHome,
  envKey,
  killProcessGroupNow,
  LakeTimeoutError,
  leanProcessEnv,
  leanToolPath,
  leanToolchainAvailable,
  runToolCollect,
  spawnLeanTool,
  terminateProcessGroup,
} from '@main/services/lean/process';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined = 4321;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true);

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  execFile.mockReset();
  spawnCli.mockReset();
});

function pathKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((key) => key.toUpperCase() === 'PATH');
}

describe('envKey', () => {
  it('is the canonical spelling on POSIX and whatever spelling Windows has', () => {
    expect(envKey({ Path: 'x' }, 'PATH', false)).toBe('PATH');
    expect(envKey({ Path: 'x' }, 'PATH', true)).toBe('Path');
    expect(envKey({ PATH: 'x' }, 'PATH', true)).toBe('PATH');
    expect(envKey({}, 'PATH', true)).toBe('PATH');
  });
});

describe('leanProcessEnv', () => {
  it('prepends the elan bin directory to PATH exactly once on POSIX', () => {
    const bin = join(elanHome({}), 'bin');
    const fresh = leanProcessEnv(DEFAULT_LEAN_SETTINGS, {}, { base: { PATH: '/usr/bin' }, windows: false });
    expect(fresh.PATH).toBe([bin, '/usr/bin'].join(delimiter));
    expect(fresh.ELAN_HOME).toBe(elanHome({}));
    expect(fresh.LEAN_NUM_THREADS).toBe(String(DEFAULT_LEAN_SETTINGS.leanNumThreads));
    const already = leanProcessEnv(DEFAULT_LEAN_SETTINGS, {}, { base: { PATH: fresh.PATH }, windows: false });
    expect(already.PATH).toBe(fresh.PATH);
    const missing = leanProcessEnv(DEFAULT_LEAN_SETTINGS, {}, { base: {}, windows: false });
    expect(missing.PATH).toBe(bin);
  });

  it('updates the existing Path key on Windows instead of adding a second spelling', () => {
    const system = ['C:\\Windows\\system32', 'C:\\Windows'].join(delimiter);
    const env = leanProcessEnv(DEFAULT_LEAN_SETTINGS, {}, { base: { Path: system, SystemRoot: 'C:\\Windows' }, windows: true });
    // A second `PATH` key would be the only one Node's spawn keeps, dropping
    // git and curl (lake update, lake exe cache get) from the child's PATH.
    expect(pathKeys(env)).toEqual(['Path']);
    expect(env.Path).toBe([join(elanHome({}), 'bin'), system].join(delimiter));
    expect(env.SystemRoot).toBe('C:\\Windows');
  });

  it('honours the existing casing of every variable it sets on Windows', () => {
    const env = leanProcessEnv(
      { ...DEFAULT_LEAN_SETTINGS, lakeArtifactCache: true },
      { MATHLIB_CACHE_DIR: '/cache' },
      { base: { Path: 'C:\\Windows', elan_home: '/custom/elan', mathlib_cache_dir: '/old', lean_num_threads: '1' }, windows: true },
    );
    expect(env.elan_home).toBe('/custom/elan');
    expect(env.ELAN_HOME).toBeUndefined();
    expect(env.Path?.startsWith(join('/custom/elan', 'bin') + delimiter)).toBe(true);
    expect(env.mathlib_cache_dir).toBe('/cache');
    expect(env.MATHLIB_CACHE_DIR).toBeUndefined();
    expect(env.lean_num_threads).toBe(String(DEFAULT_LEAN_SETTINGS.leanNumThreads));
    expect(env.LEAN_NUM_THREADS).toBeUndefined();
    expect(env.LAKE_ARTIFACT_CACHE).toBe('true');
  });

  it('keeps POSIX case-sensitive: a lowercase variable is not the canonical one', () => {
    const env = leanProcessEnv(DEFAULT_LEAN_SETTINGS, {}, { base: { path: '/not/PATH' }, windows: false });
    expect(env.path).toBe('/not/PATH');
    expect(env.PATH).toBe(join(elanHome({}), 'bin'));
  });
});

describe('Lean tool discovery and spawning', () => {
  it('prefers an elan-managed executable and detects lake in ELAN_HOME or PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'fuse-lean-process-'));
    const elan = join(root, 'elan');
    const alternate = join(root, 'alternate');
    try {
      mkdirSync(join(elan, 'bin'), { recursive: true });
      mkdirSync(alternate, { recursive: true });
      writeFileSync(join(elan, 'bin', 'lake'), '');
      writeFileSync(join(alternate, 'lake'), '');

      expect(leanToolPath('lake', { ELAN_HOME: elan })).toBe(join(elan, 'bin', 'lake'));
      expect(leanToolPath('lean', { ELAN_HOME: elan })).toBe('lean');
      expect(leanToolchainAvailable({ ELAN_HOME: elan, PATH: '' })).toBe(true);
      expect(leanToolchainAvailable({ ELAN_HOME: join(root, 'missing'), PATH: alternate })).toBe(true);
      expect(leanToolchainAvailable({ ELAN_HOME: join(root, 'missing'), PATH: '' })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('spawns the selected tool with piped stdio and its own POSIX process group', () => {
    const child = new FakeChild();
    spawnCli.mockReturnValue(child);
    const env = { PATH: '/usr/bin', ELAN_HOME: '/missing/elan' };

    expect(spawnLeanTool('lake', ['build', 'Foo'], { cwd: '/repo', env })).toBe(child);
    expect(spawnCli).toHaveBeenCalledWith('lake', ['build', 'Foo'], {
      cwd: '/repo',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  });
});

describe('process tree termination', () => {
  it('signals the POSIX process group immediately and ignores an exited process', () => {
    const child = new FakeChild();
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    killProcessGroupNow(child.asChildProcess(), 'SIGINT');
    if (process.platform === 'win32') {
      expect(execFile).toHaveBeenCalledWith('taskkill', ['/PID', '4321', '/T', '/F'], { windowsHide: true }, expect.any(Function));
    } else {
      expect(processKill).toHaveBeenCalledWith(-4321, 'SIGINT');
    }
    expect(child.kill).not.toHaveBeenCalled();

    child.exitCode = 0;
    killProcessGroupNow(child.asChildProcess());
    expect(process.platform === 'win32' ? execFile : processKill).toHaveBeenCalledTimes(1);
  });

  it('falls back to killing the root child if group signaling throws', () => {
    const child = new FakeChild();
    if (process.platform === 'win32') execFile.mockImplementation(() => { throw new Error('taskkill failed'); });
    else vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('no such group'); });

    killProcessGroupNow(child.asChildProcess(), 'SIGTERM');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('waits after SIGTERM and does not escalate when the child exits', async () => {
    const child = new FakeChild();
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const terminated = terminateProcessGroup(child.asChildProcess(), 'shutdown', 50);
    if (process.platform === 'win32') expect(execFile).toHaveBeenCalledOnce();
    else expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    child.close(0);
    await terminated;

    expect(process.platform === 'win32' ? execFile : processKill).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('escalates a stubborn process to SIGKILL and waits for its exit', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const terminated = terminateProcessGroup(child.asChildProcess(), 'timeout', 50);
    if (process.platform === 'win32') expect(execFile).toHaveBeenCalledOnce();
    else expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(50);
    if (process.platform === 'win32') expect(execFile).toHaveBeenCalledTimes(2);
    else expect(processKill).toHaveBeenLastCalledWith(-4321, 'SIGKILL');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.close(null, 'SIGKILL');
    await terminated;
  });
});

describe('runToolCollect', () => {
  it('collects stdout and stderr in arrival order and returns a nonzero exit', async () => {
    const child = new FakeChild();
    spawnCli.mockReturnValue(child);
    const env = { PATH: '/usr/bin' };
    const result = runToolCollect('lake', ['update'], { cwd: '/repo', env, timeoutMs: 5_000 });

    child.stdout.write(Buffer.from('out-1\n'));
    child.stderr.write(Buffer.from('err-1\n'));
    child.stdout.write(Buffer.from('out-2\n'));
    child.close(7);

    await expect(result).resolves.toEqual({ exitCode: 7, output: 'out-1\nerr-1\nout-2\n' });
    expect(child.stdin.writableEnded).toBe(true);
  });

  it('returns a null exit code when the tool closes due to a signal', async () => {
    const child = new FakeChild();
    spawnCli.mockReturnValue(child);
    const result = runToolCollect('lean', ['--version'], { cwd: '/repo', env: {}, timeoutMs: 5_000 });

    child.stderr.write('terminated');
    child.close(null, 'SIGTERM');

    await expect(result).resolves.toEqual({ exitCode: null, output: 'terminated' });
  });

  it('rejects a spawn error and removes abort/timer cleanup', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnCli.mockReturnValue(child);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const failure = new Error('spawn lake ENOENT');
    const result = runToolCollect('lake', ['build'], { cwd: '/repo', env: {}, timeoutMs: 100, signal: controller.signal });

    child.emit('error', failure);

    await expect(result).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('terminates on abort and reports the standard AbortError shape', async () => {
    const child = new FakeChild();
    spawnCli.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const controller = new AbortController();
    const result = runToolCollect('lake', ['build'], { cwd: '/repo', env: {}, timeoutMs: 5_000, signal: controller.signal });

    controller.abort();
    if (process.platform === 'win32') expect(execFile).toHaveBeenCalledOnce();
    else expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    child.close(null, 'SIGTERM');

    await expect(result).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
  });

  it('terminates on timeout and reports the command and duration', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnCli.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const result = runToolCollect('elan', ['toolchain', 'list'], { cwd: '/repo', env: {}, timeoutMs: 1_500 });

    await vi.advanceTimersByTimeAsync(1_500);
    if (process.platform === 'win32') expect(execFile).toHaveBeenCalledOnce();
    else expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    child.close(null, 'SIGTERM');

    await expect(result).rejects.toBeInstanceOf(LakeTimeoutError);
    await expect(result).rejects.toThrow('elan toolchain list timed out after 1.5s');
  });
});
