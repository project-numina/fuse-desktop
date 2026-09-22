/**
 * Watches a blueprint's `.tex` files (the entrypoint and its `\input` chain)
 * for edits made outside the app — an agent CLI, another editor, a git
 * checkout — and reports the repo-relative paths whose *content* changed.
 *
 * Design notes:
 * - Directories are watched, not files. Editors and `git` replace files by
 *   writing a temp file and renaming it over the target, which detaches a
 *   per-file inotify/FSEvents handle; a directory watch survives that and
 *   sees the rename. Only the basenames we care about are considered.
 * - A watched file may not exist yet (an `\input` whose chapter has not been
 *   written): its directory is watched so the create is seen, and when even
 *   the directory is missing the nearest existing ancestor is watched until
 *   it appears.
 * - Events are debounced and confirmed by hashing the file: `fs.watch` is
 *   noisy (two events per save, spurious events on metadata changes), and
 *   the service must not publish `blueprint_edit` for a no-op.
 * - Writes made by the app itself are suppressed by content hash
 *   (`noteOwnWrite` moves the file's baseline to what was written) rather
 *   than by timing, so a slow disk cannot let one of our own saves bounce
 *   back as an "external" edit. The baseline is the only marker: once the
 *   file is seen with other content, a later return to our text (a
 *   `git checkout`, an editor undo) is an external edit like any other.
 * - Where `fs.watch` is unavailable (some network/virtual file systems,
 *   inotify limits) the watcher falls back to polling `stat` on each file.
 *   The same lightweight check also runs alongside native watches to recover
 *   from silently dropped events or edits during watcher startup. It checks
 *   only known blueprint files, never walks the repository tree.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export interface BlueprintWatcherOptions {
  /** Absolute repository folder; watched paths are POSIX paths relative to it. */
  clonePath: string;
  /** Called with the repo-relative paths whose content changed on disk. */
  onChange: (changed: string[]) => void | Promise<void>;
  /** Quiet period after the last raw event before files are re-read (default 300 ms). */
  debounceMs?: number;
  /** Stat reconciliation interval, also used without native watches (default 2 s). */
  pollIntervalMs?: number;
  /** Skip `fs.watch` entirely (tests, or a file system known not to support it). */
  forcePolling?: boolean;
  /** Receives non-fatal problems (watch setup failures, read errors). */
  onWarning?: (message: string, error?: unknown) => void;
}

interface WatchedFile {
  relative: string;
  absolute: string;
  directory: string;
  basename: string;
  /** Hash of the content last seen on disk (null when the file was absent). */
  lastHash: string | null;
  /** Last observed mtime+size, used by the polling fallback to skip unchanged files. */
  lastStamp: string | null;
}

export function contentHash(content: string | Buffer): string {
  return createHash('sha1').update(content).digest('hex');
}

function toAbsolute(clonePath: string, relative: string): string {
  return join(clonePath, ...relative.split('/'));
}

function statStamp(path: string): string | null {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function readHash(path: string): string | null {
  try {
    return contentHash(readFileSync(path));
  } catch {
    return null;
  }
}

/** The first path segment of `child` below `ancestor`, or null when `child` is not strictly below it. */
function firstSegmentBelow(ancestor: string, child: string): string | null {
  const rel = relative(ancestor, child);
  if (!rel || rel === '.' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep)[0] || null;
}

export class BlueprintWatcher {
  private readonly files = new Map<string, WatchedFile>();
  private readonly directoryWatchers = new Map<string, FSWatcher>();
  private readonly pending = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  private polling = false;
  private checking: Promise<void> = Promise.resolve();

  constructor(private readonly options: BlueprintWatcherOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** True once the watcher gave up on `fs.watch` and polls instead. */
  get isPolling(): boolean {
    return this.polling;
  }

  get watchedFiles(): string[] {
    return [...this.files.keys()];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.polling = this.options.forcePolling === true;
    this.syncDirectoryWatchers();
    this.ensurePollTimer();
  }

  stop(): void {
    this.running = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const watcher of this.directoryWatchers.values()) watcher.close();
    this.directoryWatchers.clear();
    this.pending.clear();
  }

  /**
   * Replace the set of watched repo-relative paths. Files already watched
   * keep their baseline hash so a pending change is not lost; new files are
   * baselined from disk now (only later changes are reported). A path that
   * does not exist yet is watched with an "absent" baseline, so its creation
   * is reported.
   */
  setFiles(relativePaths: readonly string[]): void {
    const wanted = new Set(relativePaths.filter((path) => path.length > 0));
    for (const relative of [...this.files.keys()]) {
      if (!wanted.has(relative)) this.files.delete(relative);
    }
    for (const relative of wanted) {
      if (this.files.has(relative)) continue;
      const absolute = toAbsolute(this.options.clonePath, relative);
      this.files.set(relative, {
        relative,
        absolute,
        directory: dirname(absolute),
        basename: relative.split('/').pop() ?? relative,
        lastHash: readHash(absolute),
        lastStamp: statStamp(absolute),
      });
    }
    if (!this.running) return;
    this.syncDirectoryWatchers();
  }

  /**
   * Record content the app itself just wrote so the resulting file-system
   * event is not reported as an external edit: the file's baseline becomes
   * this content, and only a later change away from it is reported.
   */
  noteOwnWrite(relative: string, content: string | Buffer): void {
    const file = this.files.get(relative);
    if (!file) return;
    file.lastHash = contentHash(content);
    file.lastStamp = statStamp(file.absolute);
  }

  /** Force a check of every watched file now (tests, resume after sleep). */
  async checkNow(): Promise<void> {
    for (const relative of this.files.keys()) this.pending.add(relative);
    await this.flush();
  }

  /**
   * The directory to watch for a file: its own directory when it exists,
   * else the nearest existing ancestor (never above the clone), whose
   * events tell us when the missing directory appears.
   */
  private watchTargetFor(file: WatchedFile): string | null {
    let directory = file.directory;
    for (;;) {
      if (existsSync(directory)) return directory;
      if (firstSegmentBelow(this.options.clonePath, directory) === null) return null;
      const parent = dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  }

  /** Open watchers for every directory the current file set needs and close the rest. */
  private syncDirectoryWatchers(): void {
    if (this.polling) return;
    const directories = new Set<string>();
    for (const file of this.files.values()) {
      const target = this.watchTargetFor(file);
      if (target !== null) directories.add(target);
    }
    for (const [directory, watcher] of this.directoryWatchers) {
      if (!directories.has(directory)) {
        watcher.close();
        this.directoryWatchers.delete(directory);
      }
    }
    for (const directory of directories) this.watchDirectory(directory);
  }

  private watchDirectory(directory: string): void {
    if (this.polling || this.directoryWatchers.has(directory)) return;
    if (!existsSync(directory)) return;
    try {
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        this.onRawEvent(directory, filename === null ? null : String(filename));
      });
      watcher.on('error', (error) => {
        this.options.onWarning?.(`Watcher for ${directory} failed; switching to polling`, error);
        this.switchToPolling();
      });
      this.directoryWatchers.set(directory, watcher);
    } catch (error) {
      this.options.onWarning?.(`fs.watch unavailable for ${directory}; switching to polling`, error);
      this.switchToPolling();
    }
  }

  private switchToPolling(): void {
    this.polling = true;
    for (const watcher of this.directoryWatchers.values()) watcher.close();
    this.directoryWatchers.clear();
    this.ensurePollTimer();
  }

  private ensurePollTimer(): void {
    if (!this.running || this.pollTimer) return;
    const interval = this.options.pollIntervalMs ?? 2000;
    this.pollTimer = setInterval(() => {
      for (const file of this.files.values()) {
        const stamp = statStamp(file.absolute);
        if (stamp !== file.lastStamp) this.pending.add(file.relative);
      }
      if (this.pending.size > 0) void this.flush();
    }, interval);
    this.pollTimer.unref();
  }

  private onRawEvent(directory: string, filename: string | null): void {
    let rearm = false;
    for (const file of this.files.values()) {
      if (file.directory === directory) {
        // Some platforms omit the filename; re-check every file in that directory.
        if (filename === null || filename === file.basename) this.pending.add(file.relative);
        continue;
      }
      // An ancestor watch stands in for a directory that did not exist: an
      // event naming its first missing segment may be that directory being
      // created (possibly with the file already inside), so re-check the
      // file and move the watch down to the directory itself.
      if (this.directoryWatchers.has(file.directory)) continue;
      const segment = firstSegmentBelow(directory, file.directory);
      if (segment === null || (filename !== null && filename !== segment)) continue;
      this.pending.add(file.relative);
      rearm = true;
    }
    if (rearm) this.syncDirectoryWatchers();
    if (this.pending.size === 0) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.options.debounceMs ?? 300);
    this.debounceTimer.unref();
  }

  /** Re-read pending files; report the ones whose content really changed. */
  private flush(): Promise<void> {
    // Serialize checks so a burst of events cannot interleave two callbacks.
    this.checking = this.checking.then(() => this.check()).catch((error) => {
      this.options.onWarning?.('Blueprint watcher check failed', error);
    });
    return this.checking;
  }

  private async check(): Promise<void> {
    const changed: string[] = [];
    for (const relative of [...this.pending]) {
      this.pending.delete(relative);
      const file = this.files.get(relative);
      if (!file) continue;
      const hash = readHash(file.absolute);
      file.lastStamp = statStamp(file.absolute);
      if (hash === file.lastHash) continue;
      file.lastHash = hash;
      changed.push(relative);
    }
    if (changed.length === 0 || !this.running) return;
    await this.options.onChange(changed);
  }
}
