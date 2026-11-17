import type { ChildProcess } from 'node:child_process';
import { JsonLineReader } from '../jsonl';
import { killCli, spawnCli } from '../spawn';
import { asRecord, asString, type ThreadLaunch } from '../types';

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexTransportHooks {
  notification: (method: string, params: Record<string, unknown>) => void;
  request: (id: string | number, method: string, params: Record<string, unknown>) => void;
  log: (message: string) => void;
  exit: (message: string) => void;
}

/** One app-server connection; JSON-RPC requests never travel through a shell. */
export class CodexTransport {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private stopped = false;

  constructor(launch: ThreadLaunch, args: string[], private readonly hooks: CodexTransportHooks) {
    this.child = spawnCli(launch.executable || 'codex', args, {
      cwd: launch.repoPath,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const reader = new JsonLineReader((value) => this.receive(asRecord(value)), hooks.log);
    this.child.stdout?.on('data', (chunk: Buffer) => reader.push(chunk));
    this.child.stderr?.on('data', (chunk: Buffer) => hooks.log(chunk.toString().trim()));
    this.child.stdin?.on('error', (error) => this.fail(`Codex input closed: ${error.message}`));
    this.child.on('error', (error) => this.fail(`Failed to start Codex: ${error.message}`));
    this.child.on('exit', (code, signal) => {
      reader.end();
      this.fail(`Codex app-server exited (${signal ?? code}).`);
    });
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.stopped) return Promise.reject(new Error('Codex app-server is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string): void { this.write({ method }); }

  respond(id: string | number, result: Record<string, unknown>): void { this.write({ id, result }); }

  reject(id: string | number, message: string): void {
    this.write({ id, error: { code: -32601, message } });
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.rejectPending('Codex app-server closed.');
    killCli(this.child, 'SIGTERM');
    const child = this.child;
    const timer = setTimeout(() => { if (child.exitCode === null) killCli(child, 'SIGKILL'); }, 3000);
    timer.unref();
  }

  private write(value: unknown): void {
    if (!this.stopped) this.child.stdin?.write(`${JSON.stringify(value)}\n`);
  }

  private receive(record: Record<string, unknown>): void {
    const method = asString(record.method);
    if (method) {
      const params = asRecord(record.params);
      if (typeof record.id === 'number' || typeof record.id === 'string') this.hooks.request(record.id, method, params);
      else this.hooks.notification(method, params);
      return;
    }
    if (typeof record.id !== 'number') return;
    const pending = this.pending.get(record.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(record.id);
    if (record.error) pending.reject(new Error(asString(asRecord(record.error).message) ?? JSON.stringify(record.error)));
    else pending.resolve(asRecord(record.result));
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private fail(message: string): void {
    if (this.stopped) return;
    this.close();
    this.hooks.exit(message);
  }
}
