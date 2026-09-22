import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderId } from '@shared/agent-events';
import type { ProviderInfo } from '@shared/desktop';
import { resolveCliCommand } from './spawn';

const execFileAsync = promisify(execFile);

const COMMANDS: Record<ProviderId, { label: string; command: string }> = {
  claude: { label: 'Claude Code', command: 'claude' },
  codex: { label: 'Codex', command: 'codex' },
};

async function resolveOnPath(command: string): Promise<string | null> {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(lookup, [command], { windowsHide: true });
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

async function readVersion(executable: string): Promise<string | null> {
  // Resolved like a session launch (npm .cmd shims are read, never run
  // through cmd.exe), so a path with spaces works on Windows too.
  const command = resolveCliCommand(executable, ['--version']);
  try {
    const { stdout } = await execFileAsync(command.file, command.args, {
      windowsHide: true,
      timeout: 15_000,
      shell: command.shell,
      env: { ...process.env, ...command.env },
    });
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

export async function detectProvider(id: ProviderId, override: string): Promise<ProviderInfo> {
  const { label, command } = COMMANDS[id];
  const executable = override.trim() || (await resolveOnPath(command));
  if (!executable) {
    return {
      id,
      label,
      command,
      available: false,
      version: null,
      path: null,
      error: `Could not find \`${command}\` on your PATH. Install it or set its location in Settings.`,
    };
  }
  const version = await readVersion(executable);
  return {
    id,
    label,
    command,
    available: version !== null,
    version,
    path: executable,
    error: version === null ? `\`${executable}\` did not respond to --version.` : null,
  };
}

export async function detectProviders(overrides: { claudePath: string; codexPath: string }): Promise<ProviderInfo[]> {
  return Promise.all([
    detectProvider('claude', overrides.claudePath),
    detectProvider('codex', overrides.codexPath),
  ]);
}
