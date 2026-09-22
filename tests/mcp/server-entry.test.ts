import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { close, connect, createFuseServer, readFuseEnv, transport } = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(),
  createFuseServer: vi.fn(),
  readFuseEnv: vi.fn(),
  transport: { kind: 'stdio-test-transport' },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function StdioServerTransport() { return transport; }),
}));
vi.mock('@mcp/create-server', () => ({ createFuseServer }));
vi.mock('@mcp/env', () => ({ readFuseEnv }));

describe('MCP server entry point', () => {
  let stdinEnd: (() => void) | undefined;
  let stdinOn: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    close.mockResolvedValue(undefined);
    connect.mockResolvedValue(undefined);
    createFuseServer.mockReturnValue({ close, connect });
    readFuseEnv.mockReturnValue({ apiUrl: 'http://127.0.0.1:3000', apiToken: 'secret' });
    stdinOn = vi.spyOn(process.stdin, 'on').mockImplementation(((event: string, listener: () => void) => {
      if (event === 'end') stdinEnd = listener;
      return process.stdin;
    }) as typeof process.stdin.on);
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdinOn.mockRestore();
    exit.mockRestore();
    consoleError.mockRestore();
  });

  it('creates and connects the stdio server, then closes it before exiting on stdin end', async () => {
    await import('@mcp/server');
    await Promise.resolve();

    expect(readFuseEnv).toHaveBeenCalledOnce();
    expect(createFuseServer).toHaveBeenCalledWith({ env: { apiUrl: 'http://127.0.0.1:3000', apiToken: 'secret' } });
    expect(connect).toHaveBeenCalledWith(transport);
    expect(stdinEnd).toBeTypeOf('function');

    stdinEnd?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('logs a safe Error message and exits nonzero when startup fails', async () => {
    connect.mockRejectedValue(new Error('could not bind transport'));

    await import('@mcp/server');
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('could not bind transport');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('stringifies non-Error startup failures', async () => {
    readFuseEnv.mockImplementation(() => { throw { reason: 'bad env' }; });

    await import('@mcp/server');
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('[object Object]');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
