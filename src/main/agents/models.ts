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
 * its model listing, and stops it.
 */

const PROBE_TIMEOUT_MS = 20_000;

const activeProbes = new Set<() => Promise<void>>();

/** Stop model discovery before Electron exits, including probes that already answered. */
export async function stopModelProbes(): Promise<void> {
  await Promise.all([...activeProbes].map(stop => stop()));
}

const COMMANDS: Record<ProviderId, string> = { claude: 'claude', codex: 'codex' };

/** One successful listing per provider and executable for the app's lifetime. */
const cache = new Map<string, Promise<ModelOption[]>>();

export function listModels(provider: ProviderId, override: string): Promise<ModelOption[]> {
  if (provider !== 'claude' && provider !== 'codex') return Promise.reject(new Error('Unknown model provider.'));
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
  const models: ModelOption[] = [];
  let requestId = 1;
  const requests = [{ id: requestId, method: 'initialize', params: { clientInfo: { name: 'fuse-desktop', version: '0' } } }];
  return probe(executable, ['app-server'], requests, (line, write) => {
    const message = asRecord(line);
    if (message.id !== requestId) return undefined;
    if (message.error) throw new Error(asString(asRecord(message.error).message) || 'Codex refused the model request.');
    if (requestId === 1) {
      write({ method: 'initialized' });
      write({ id: ++requestId, method: 'model/list', params: {} });
      return undefined;
    }
    models.push(...parseCodexModels(message.result));
    const cursor = asString(asRecord(message.result).nextCursor);
    if (cursor) {
      write({ id: ++requestId, method: 'model/list', params: { cursor } });
      return undefined;
    }
    return models;
  });
}

/** Start the CLI and settle once its protocol reader has a complete listing. */
function probe(
  executable: string,
  args: string[],
  requests: unknown[],
  read: (line: unknown, write: (request: unknown) => void) => ModelOption[] | undefined,
): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawnCli(executable, args, { cwd: tmpdir(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = trackProbe(child, () => finish(new Error('Model discovery stopped.')));
    const finish = (error: Error | null, models?: ModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      if (error) reject(error);
      else resolve(models ?? []);
    };
    const timer = setTimeout(() => finish(new Error(`${executable} did not list its models in time.`)), PROBE_TIMEOUT_MS);
    const write = (request: unknown) => {
      if (!settled) child.stdin.write(`${JSON.stringify(request)}\n`);
    };
    const reader = new JsonLineReader((value) => {
      if (settled) return;
      try {
        const models = read(value, write);
        if (models) finish(null, models);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    }, () => undefined);
    // Decode across buffer boundaries so multibyte model labels stay intact.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => reader.push(chunk));
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', (error) => finish(error));
    child.on('error', (error) => finish(error));
    // `exit` can precede the last stdout chunk; only `close` guarantees it drained.
    child.on('close', () => {
      reader.end();
      finish(new Error(`${executable} exited before listing its models.`));
    });
    for (const request of requests) write(request);
  });
}

/** Bound graceful termination and retain ownership until the process has stopped. */
function trackProbe(child: ReturnType<typeof spawnCli>, cancel: () => void): () => void {
  let exited = false;
  let stopping = false;
  let killTimer: NodeJS.Timeout | undefined;
  let release!: () => void;
  const stopped = new Promise<void>(resolve => { release = resolve; });
  const shutdown = () => { cancel(); stop(); return stopped; };
  const cleanup = () => {
    exited = true;
    clearTimeout(killTimer);
    activeProbes.delete(shutdown);
    release();
  };
  const stop = () => {
    if (exited || stopping) return;
    stopping = true;
    try {
      child.stdin.end();
    } catch {
      // Already closed by an exiting CLI.
    }
    killTimer = setTimeout(() => {
      killCli(child, 'SIGKILL');
      cleanup();
    }, 3000);
    killTimer.unref();
    killCli(child, 'SIGTERM');
  };
  activeProbes.add(shutdown);
  child.once('exit', cleanup);
  child.once('close', cleanup); // Failed spawns emit close without exit.
  return stop;
}
