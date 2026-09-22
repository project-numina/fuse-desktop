/**
 * A tiny persistent JSON document: read once, mutate in memory, write
 * atomically (temp file + rename) behind a short debounce. Used for every
 * registry and transcript file the app keeps.
 *
 * Writes are synchronous on purpose. The files are small (rows and
 * transcripts, serialized on this thread either way), and a synchronous
 * write means the shutdown path's `flushSync` can never overlap an
 * in-flight asynchronous write of the same file — an interleaving that used
 * to let the older write win, or leave truncated JSON on disk.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const JSON_FILE_DEBOUNCE_MS = 200;

export class JsonFile<T> {
  private value: T;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    readonly path: string,
    private readonly initial: () => T,
    private readonly migrate: (raw: unknown) => T = (raw) => raw as T,
    private readonly serialize: { serialize(value: T): unknown }['serialize'] = (value) => value,
  ) {
    this.value = this.load();
  }

  get(): T {
    return this.value;
  }

  /** Replace the document and schedule a write. */
  set(next: T): void {
    this.value = next;
    this.schedule();
  }

  /** Mutate in place and schedule a write. */
  update(mutate: (value: T) => void): void {
    mutate(this.value);
    this.schedule();
  }

  /** Resolve once every scheduled write has landed. */
  async settled(): Promise<void> {
    this.flush();
  }

  /** Write now (shutdown, or before the file is removed). A no-op when clean. */
  flushSync(): void {
    this.flush();
  }

  private load(): T {
    if (!existsSync(this.path)) return this.initial();
    try {
      return this.migrate(JSON.parse(readFileSync(this.path, 'utf8')));
    } catch (error) {
      console.warn(`Unreadable ${this.path}; starting fresh:`, error);
      return this.initial();
    }
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), JSON_FILE_DEBOUNCE_MS);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.serialize(this.value)));
      renameSync(temporary, this.path);
    } catch (error) {
      // Keep the document dirty so a later flush (or the shutdown flush)
      // retries; a failing disk must not take the other files down with it.
      this.dirty = true;
      console.warn(`Failed to save ${this.path}:`, error);
    }
  }
}
