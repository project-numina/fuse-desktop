import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileAsync, resolveCliCommand } = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  resolveCliCommand: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: () => execFileAsync }));
vi.mock('@main/agents/spawn', () => ({ resolveCliCommand }));

const { detectProvider, detectProviders } = await import('@main/agents/detect');

describe('provider detection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveCliCommand.mockImplementation((executable: string, args: string[]) => ({
      file: `/resolved/${executable}`,
      args,
      shell: false,
      env: { DETECT_TEST: '1' },
    }));
  });

  it('finds a CLI on PATH, resolves it like a normal launch, and reads the first version line', async () => {
    execFileAsync
      .mockResolvedValueOnce({ stdout: '\n /opt/tools/codex \n/other/codex\n' })
      .mockResolvedValueOnce({ stdout: 'codex-cli 1.2.3\nextra details\n' });

    await expect(detectProvider('codex', '   ')).resolves.toEqual({
      id: 'codex',
      label: 'Codex',
      command: 'codex',
      available: true,
      version: 'codex-cli 1.2.3',
      path: '/opt/tools/codex',
      error: null,
    });

    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      process.platform === 'win32' ? 'where' : 'which',
      ['codex'],
      { windowsHide: true },
    );
    expect(resolveCliCommand).toHaveBeenCalledWith('/opt/tools/codex', ['--version']);
    expect(execFileAsync).toHaveBeenNthCalledWith(2, '/resolved//opt/tools/codex', ['--version'], expect.objectContaining({
      windowsHide: true,
      timeout: 15_000,
      shell: false,
      env: expect.objectContaining({ DETECT_TEST: '1' }),
    }));
  });

  it('reports a missing CLI without attempting a version command', async () => {
    execFileAsync.mockRejectedValueOnce(new Error('not found'));

    await expect(detectProvider('claude', '')).resolves.toEqual({
      id: 'claude',
      label: 'Claude Code',
      command: 'claude',
      available: false,
      version: null,
      path: null,
      error: 'Could not find `claude` on your PATH. Install it or set its location in Settings.',
    });
    expect(resolveCliCommand).not.toHaveBeenCalled();
  });

  it('uses configured paths verbatim and marks a CLI unavailable when --version fails', async () => {
    execFileAsync.mockRejectedValueOnce(new Error('bad executable'));

    await expect(detectProvider('codex', '  /custom/codex  ')).resolves.toEqual(expect.objectContaining({
      available: false,
      version: null,
      path: '/custom/codex',
      error: '`/custom/codex` did not respond to --version.',
    }));
    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(resolveCliCommand).toHaveBeenCalledWith('/custom/codex', ['--version']);
  });

  it('detects both configured providers in stable order', async () => {
    execFileAsync
      .mockResolvedValueOnce({ stdout: 'Claude 9\n' })
      .mockResolvedValueOnce({ stdout: 'Codex 7\n' });

    const providers = await detectProviders({ claudePath: '/bin/claude', codexPath: '/bin/codex' });

    expect(providers.map(({ id, version }) => ({ id, version }))).toEqual([
      { id: 'claude', version: 'Claude 9' },
      { id: 'codex', version: 'Codex 7' },
    ]);
  });
});
