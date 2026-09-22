import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryResource } from '@/lib/memory-resource';

afterEach(() => vi.useRealTimers());
describe('memory resource', () => {
  it('coalesces reads, expires, and permits explicit refresh', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue('one');
    const cache = new MemoryResource(fetch, 1000);
    await Promise.all([cache.read(), cache.read()]);
    await cache.read();
    expect(fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1001);
    await cache.read();
    await cache.read(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('retains a good result on error and retries failed reads', async () => {
    const fetch = vi.fn().mockResolvedValueOnce('one').mockRejectedValueOnce(new Error('offline')).mockResolvedValue('two');
    const cache = new MemoryResource(fetch, 0);
    await cache.read();
    await expect(cache.read()).rejects.toThrow('offline');
    expect(cache.value).toBe('one');
    expect(await cache.read()).toBe('two');
  });
  it('does not let an old read undo a newer saved value', async () => {
    let finish!: (value: string) => void;
    const cache = new MemoryResource(() => new Promise<string>(resolve => { finish = resolve; }), 0);
    const pending = cache.read();
    cache.set('saved');
    finish('old');
    expect(await pending).toBe('saved');
    expect(cache.value).toBe('saved');
  });
  it('runs an explicit recheck after an older pending request', async () => {
    let finish!: (value: string) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue('new path');
    const cache = new MemoryResource<string>(fetch, 60_000);
    const original = cache.read();
    const recheck = cache.read(true);
    finish('old path');
    await original;
    expect(await recheck).toBe('new path');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
