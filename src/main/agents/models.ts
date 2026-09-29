import { tmpdir } from 'node:os';
import type { ProviderId } from '@shared/agent-events';
import type { ModelOption } from '@shared/desktop';
import { JsonLineReader } from './jsonl';
import { killCli, spawnCli } from './spawn';
import { asRecord, asString } from './types';

/**
 * The model menu comes from the installed CLIs themselves, so it follows
 * their releases instead of a list compiled into the app. Claude Code reports
 * its models in the stream-json `initialize` control response; Codex answers
 * `model/list` over `codex app-server`. Each probe starts the CLI once, reads
 * the one reply, and stops it.
 */

const PROBE_TIMEOUT_MS = 20_000;

const COMMANDS: Record<ProviderId, string> = { claude: 'claude', codex: 'codex' };

/** One successful listing per provider and executable for the app's lifetime. */
const cache = new Map<string, Promise<ModelOption[]>>();

export function listModels(provider: ProviderId, override: string): Promise<ModelOption[]> {
  const executable = override.trim() || COMMANDS[provider];
  const key = `${provider}\0${executable}`;
  let listing = cache.get(key);
  if (!listing) {
    listing = provider === 'claude' ? probeClaude(executable) : probeCodex(executable);
    // A failed probe (CLI missing, signed out, offline) is retried next time.
    listing.catch(() => cache.delete(key));
    cache.set(key, listing);
  }
  return listing;
}

/** Parse Claude Code's `initialize` response; `default` is the picker's own "CLI default". */
export function parseClaudeModels(response: unknown): ModelOption[] {
  const models = asRecord(response).models;
  if (!Array.isArray(models)) throw new Error('Claude Code did not report its models.');
  return models.flatMap((entry) => {
    const model = asRecord(entry);
    const value = asString(model.value);
    if (!value || value === 'default') return [];
    return [{ value, label: asString(model.displayName) || value, description: asString(model.description) || undefined }];
  });
}

/** Parse Codex's `model/list` result, leaving out models it marks hidden. */
export function parseCodexModels(result: unknown): ModelOption[] {
  const data = asRecord(result).data;
  if (!Array.isArray(data)) throw new Error('Codex did not report its models.');
  return data.flatMap((entry) => {
    const model = asRecord(entry);
    const value = asString(model.id) || asString(model.model);
    if (!value || model.hidden === true) return [];
    return [{ value, label: asString(model.displayName) || value, description: asString(model.description) || undefined }];
  });
}

function probeClaude(executable: string): Promise<ModelOption[]> {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  return probe(executable, args, [{ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }], (line) => {
    const message = asRecord(line);
    if (message.type !== 'control_response') return undefined;
    const response = asRecord(message.response);
    if (response.request_id !== 'models') return undefined;
    if (response.subtype !== 'success') throw new Error(asString(response.error) || 'Claude Code refused the model request.');
    return parseClaudeModels(response.response);
  });
}

function probeCodex(executable: string): Promise<ModelOption[]> {
  const requests = [
    { id: 1, method: 'initialize', params: { clientInfo: { name: 'fuse-desktop', version: '0' } } },
    { method: 'initialized' },
    { id: 2, method: 'model/list', params: {} },
  ];
  return probe(executable, ['app-server'], requests, (line) => {
    const message = asRecord(line);
    if (message.id !== 2) return undefined;
    if (message.error) throw new Error(asString(asRecord(message.error).message) || 'Codex refused the model request.');
    return parseCodexModels(message.result);
  });
}

/** Start the CLI, write `requests`, and settle with the first line `read` answers. */
function probe(
  executable: string,
  args: string[],
  requests: unknown[],
  read: (line: unknown) => ModelOption[] | undefined,
): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawnCli(executable, args, { cwd: tmpdir(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (error: Error | null, models?: ModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        // Already closed by an exiting CLI.
      }
      if (child.exitCode === null) killCli(child, 'SIGTERM');
      if (error) reject(error);
      else resolve(models ?? []);
    };
    const timer = setTimeout(() => finish(new Error(`${executable} did not list its models in time.`)), PROBE_TIMEOUT_MS);
    const reader = new JsonLineReader((value) => {
      try {
        const models = read(value);
        if (models) finish(null, models);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    }, () => undefined);
    child.stdout.on('data', (chunk: Buffer) => reader.push(chunk));
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => finish(error));
    child.on('exit', () => {
      reader.end();
      finish(new Error(`${executable} exited before listing its models.`));
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}
