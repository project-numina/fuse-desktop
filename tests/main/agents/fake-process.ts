/**
 * Test double for `child_process.spawn`: an EventEmitter with writable stdin
 * and readable stdout/stderr, so adapters can be driven with recorded CLI
 * output without launching anything.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: string[] = [];
  stdinText = '';
  exitCode: number | null = null;
  killed: NodeJS.Signals | null = null;

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      this.stdinText += chunk.toString();
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) this.written.push(line);
      }
    });
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? 'SIGTERM';
    return true;
  }

  /** Emit one JSON line on stdout. */
  emitLine(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.emit('exit', code, signal);
  }

  /** Control messages the adapter wrote to stdin, parsed. */
  writtenJson(): Array<Record<string, unknown>> {
    return this.written.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
