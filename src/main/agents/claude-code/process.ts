import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { JsonLineReader } from '../jsonl';
import { killCli, spawnCli } from '../spawn';
import { buildClaudeArgs, buildClaudeEnvironment } from './options';
import type { ThreadLaunch } from '../types';

export interface ClaudeProcessCallbacks {
  onLine(value: unknown, source: ClaudeProcess): void;
  onInvalidLine(line: string, source: ClaudeProcess): void;
  onStderr(line: string): void;
  onError(error: Error, source: ClaudeProcess): void;
  onExit(code: number | null, signal: NodeJS.Signals | null, source: ClaudeProcess): void;
}

/** A single warm Claude Code process and its newline-delimited transport. */
export class ClaudeProcess {
  private readonly reader: JsonLineReader;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    callbacks: ClaudeProcessCallbacks,
  ) {
    this.reader = new JsonLineReader(
      (value) => callbacks.onLine(value, this),
      (line) => callbacks.onInvalidLine(line, this),
    );
    child.stdout.on('data', (chunk: Buffer) => this.reader.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => this.forwardStderr(chunk, callbacks));
    // Early CLI exits close stdin under a pending write. The exit callback is
    // authoritative, so the stream error itself must not escape EventEmitter.
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => callbacks.onError(error, this));
    child.on('exit', (code, signal) => {
      this.reader.end();
      callbacks.onExit(code, signal, this);
    });
  }

  static start(launch: ThreadLaunch, sessionId: string | null, callbacks: ClaudeProcessCallbacks): ClaudeProcess {
    const child = spawnCli(launch.executable || 'claude', buildClaudeArgs(launch, sessionId), {
      cwd: launch.repoPath,
      env: buildClaudeEnvironment(launch),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new ClaudeProcess(child, callbacks);
  }

  write(payload: unknown): void {
    if (!this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  stop(): void {
    try {
      this.child.stdin.end();
    } catch {
      // The CLI may already have closed the pipe while exiting.
    }
    const killTimer = setTimeout(() => {
      if (this.child.exitCode === null) killCli(this.child, 'SIGKILL');
    }, 3000);
    this.child.once('exit', () => clearTimeout(killTimer));
    killCli(this.child, 'SIGTERM');
  }

  private forwardStderr(chunk: Buffer, callbacks: ClaudeProcessCallbacks): void {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) callbacks.onStderr(line.trimEnd());
    }
  }
}
