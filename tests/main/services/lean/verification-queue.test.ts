import { describe, expect, it, vi } from 'vitest';
import { VerificationQueue } from '@main/services/lean/verification-queue';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('VerificationQueue', () => {
  it('shares duplicate requests and serializes diagnostics behind builds', async () => {
    const queue = new VerificationQueue();
    const held = gate();
    const order: string[] = [];
    const build = queue.exclusive(async () => { order.push('build'); await held.promise; });
    const work = vi.fn(async () => { order.push('diagnostics'); return 42; });
    const first = queue.run('A', 'v1', '', () => 'v1', work);
    const duplicate = queue.run('A', 'v1', '', () => 'v1', work);
    expect(first).toBe(duplicate);
    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
    held.release();
    await build;
    expect(await first).toBe(42);
    expect(work).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['build', 'diagnostics']);
  });

  it('drops an obsolete queued version and runs the latest version', async () => {
    const queue = new VerificationQueue();
    const held = gate();
    const build = queue.exclusive(() => held.promise);
    let version = 'old';
    const obsoleteWork = vi.fn(async () => 1);
    const old = queue.run('A', version, '', () => version, obsoleteWork);
    const rejected = expect(old).rejects.toThrow('superseded');
    version = 'new';
    const latest = queue.run('A', version, '', () => version, async () => 2);
    held.release();
    await build;
    await rejected;
    expect(await latest).toBe(2);
    expect(obsoleteWork).not.toHaveBeenCalled();
  });

  it('cancels a queued caller without blocking later work', async () => {
    const queue = new VerificationQueue();
    const held = gate();
    const build = queue.exclusive(() => held.promise);
    const controller = new AbortController();
    const work = vi.fn(async () => 1);
    const cancelled = queue.run('A', 'v', '', () => 'v', work, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    held.release();
    await build;
    expect(await queue.run('B', 'v', '', () => 'v', async () => 2)).toBe(2);
    expect(work).not.toHaveBeenCalled();
  });
});
