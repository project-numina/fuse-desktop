import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';

const deps = vi.hoisted(() => {
  const registry = {
    addRepository: vi.fn(),
    flushSync: vi.fn(),
  };
  return {
    mkdirSync: vi.fn(),
    appPaths: vi.fn((data: string) => ({ data, repositories: `${data}/repositories.json` })),
    startLocalServer: vi.fn(),
    extendPathFromLoginShell: vi.fn().mockResolvedValue(undefined),
    registry,
    Registry: vi.fn(function Registry() { return registry; }),
    SettingsStore: vi.fn(function SettingsStore(this: { file: string }, file: string) { this.file = file; }),
    SseRooms: vi.fn(function SseRooms(this: { options: unknown }, options: unknown) { this.options = options; }),
  };
});

vi.mock('node:fs', () => ({ mkdirSync: deps.mkdirSync }));
vi.mock('@main/paths', () => ({ appPaths: deps.appPaths }));
vi.mock('@main/server/app', () => ({ startLocalServer: deps.startLocalServer }));
vi.mock('@main/server/sse', () => ({ SseRooms: deps.SseRooms }));
vi.mock('@main/settings', () => ({ SettingsStore: deps.SettingsStore }));
vi.mock('@main/shell-path', () => ({ extendPathFromLoginShell: deps.extendPathFromLoginShell }));
vi.mock('@main/store/registry', () => ({ Registry: deps.Registry }));

describe('standalone entrypoint', () => {
  const originalArgv = process.argv;
  const signals = new Map<string, () => void>();
  let onSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    signals.clear();
    onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
      signals.set(event, listener);
      return process;
    }) as typeof process.on);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    onSpy.mockRestore();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('parses CLI options, builds the app context, registers repositories, and shuts down cleanly', async () => {
    process.argv = [
      'node', 'standalone.js',
      '--data', '/tmp/fuse-data',
      '--port', '4321',
      '--token', 'secret',
      '--renderer', '/tmp/renderer',
      '--register', '/tmp/repo-a',
      '--register', '/tmp/repo-b',
      '--ignored', 'value',
    ];
    const close = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    deps.startLocalServer.mockImplementation(async (ctx: { services: Record<string, unknown> }) => {
      ctx.services.shutdown = shutdown;
      return {
        baseUrl: 'http://127.0.0.1:4321',
        token: 'secret',
        entryUrl: (route: string) => `http://127.0.0.1:4321${route}`,
        close,
      };
    });

    await import('@main/standalone');
    await vi.waitFor(() => expect(stdoutSpy).toHaveBeenCalledOnce());

    expect(deps.extendPathFromLoginShell).toHaveBeenCalledOnce();
    const data = resolve('/tmp/fuse-data');
    const paths = { data, repositories: `${data}/repositories.json` };
    expect(deps.mkdirSync).toHaveBeenCalledWith(data, { recursive: true });
    expect(deps.appPaths).toHaveBeenCalledWith(data);
    expect(deps.Registry).toHaveBeenCalledWith(paths);
    expect(deps.SettingsStore).toHaveBeenCalledWith(join(data, 'settings.json'));
    expect(deps.registry.addRepository.mock.calls.map(([path]) => path)).toEqual(['/tmp/repo-a', '/tmp/repo-b'].map((path) => resolve(path)));
    expect(deps.startLocalServer).toHaveBeenCalledWith(
      expect.objectContaining({
        paths,
        registry: deps.registry,
        resourcesDir: expect.stringMatching(/resources$/),
        server: { baseUrl: 'http://127.0.0.1:4321', token: 'secret' },
        services: { shutdown },
      }),
      { rendererDir: resolve('/tmp/renderer'), port: 4321, token: 'secret' },
    );
    expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify({
      baseUrl: 'http://127.0.0.1:4321',
      token: 'secret',
      entryUrl: 'http://127.0.0.1:4321/',
    })}\n`);
    expect(signals.has('SIGINT')).toBe(true);
    expect(signals.has('SIGTERM')).toBe(true);

    signals.get('SIGINT')?.();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    expect(deps.registry.flushSync).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    signals.get('SIGTERM')?.();
    expect(deps.registry.flushSync).toHaveBeenCalledOnce();
  });

  it('supports an ephemeral port, generated token, and no renderer', async () => {
    process.argv = ['node', 'standalone.js', '--data', '/tmp/minimal', '--renderer', 'none'];
    deps.startLocalServer.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:9999',
      token: 'generated',
      entryUrl: (route: string) => `http://127.0.0.1:9999${route}`,
      close: vi.fn(),
    });

    await import('@main/standalone');
    await vi.waitFor(() => expect(deps.startLocalServer).toHaveBeenCalledOnce());
    expect(deps.startLocalServer.mock.calls[0][1]).toEqual({ rendererDir: null, port: 0, token: undefined });
  });

  it('reports invalid invocation and exits unsuccessfully', async () => {
    process.argv = ['node', 'standalone.js'];

    await import('@main/standalone');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: '--data <dir> is required' }));
    expect(deps.startLocalServer).not.toHaveBeenCalled();
  });

  it('reports shutdown failures with a nonzero exit code', async () => {
    process.argv = ['node', 'standalone.js', '--data', '/tmp/failing'];
    const failure = new Error('close failed');
    deps.startLocalServer.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:1',
      token: 'token',
      entryUrl: () => 'http://127.0.0.1:1/',
      close: vi.fn().mockRejectedValue(failure),
    });

    await import('@main/standalone');
    await vi.waitFor(() => expect(signals.has('SIGTERM')).toBe(true));
    signals.get('SIGTERM')?.();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
    expect(errorSpy).toHaveBeenCalledWith('[fuse] shutdown failed:', failure);
  });
});
