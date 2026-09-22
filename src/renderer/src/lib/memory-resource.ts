/** One small, memory-only result. Share pending reads; preserve the last good
 * value on failure and never overwrite a newer save with an older read.
 */
export class MemoryResource<T> {
  value: T | null = null;
  private loadedAt = -Infinity;
  private pending: Promise<T> | null = null;
  private revision = 0;

  constructor(private fetch: () => Promise<T>, private ttlMs: number) {}

  set(value: T): void {
    this.revision++;
    this.value = value;
    this.loadedAt = Date.now();
  }

  read(force = false): Promise<T> {
    if (this.pending) {
      // An explicit recheck may follow a changed CLI path. Do not satisfy it
      // with a detection that began against the previous configuration.
      return force ? this.pending.catch(() => {}).then(() => this.read(true)) : this.pending;
    }
    if (!force && this.value !== null && Date.now() - this.loadedAt < this.ttlMs) return Promise.resolve(this.value);
    const revision = this.revision;
    this.pending = this.fetch().then(value => {
      if (revision === this.revision) this.set(value);
      return this.value!;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
