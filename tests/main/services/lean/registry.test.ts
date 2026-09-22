import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeanLSPClient } from '@main/services/lean/lsp/client';
import { LeanProjectRegistry } from '@main/services/lean/registry';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

class FakeClient {
  returncode: number | null = null;
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
  async closeIdleDocuments(): Promise<string[]> {
    return [];
  }
}

describe('LeanProjectRegistry', () => {
  let root: string;
  const clients: FakeClient[] = [];

  function registry(overrides: Partial<typeof DEFAULT_LEAN_SETTINGS> = {}): LeanProjectRegistry {
    return new LeanProjectRegistry({
      settings: { ...DEFAULT_LEAN_SETTINGS, lspProjectIdleMs: 1_000, lspMaxProjects: 2, lspFileIdleTtlMs: 0, ...overrides },
      serviceOptions: () => ({
        createClient: async () => {
          const client = new FakeClient();
          clients.push(client);
          return client as unknown as LeanLSPClient;
        },
      }),
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fuse-registry-'));
    clients.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('reuses one service per project and stops it after the idle grace', async () => {
    const reg = registry();
    const a = join(root, 'a');
    const first = await reg.acquire(a, a);
    const second = await reg.acquire(a, a);
    expect(second).toBe(first);
    await first.acquireClient(async () => {});
    expect(clients).toHaveLength(1);
    reg.release(a);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reg.peek(a)).toBe(first);
    reg.release(a);
    await vi.advanceTimersByTimeAsync(999);
    expect(reg.peek(a)).toBe(first);
    await vi.advanceTimersByTimeAsync(2);
    expect(reg.peek(a)).toBeNull();
    expect(clients[0].closed).toBe(true);
  });

  it('cancels the idle stop when the project is reacquired', async () => {
    const reg = registry();
    const a = join(root, 'a');
    const service = await reg.acquire(a, a);
    reg.release(a);
    await vi.advanceTimersByTimeAsync(500);
    expect(await reg.acquire(a, a)).toBe(service);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reg.peek(a)).toBe(service);
    reg.release(a);
  });

  it('evicts the least recently used idle project at the cap', async () => {
    const reg = registry();
    const [a, b, c] = ['a', 'b', 'c'].map((name) => join(root, name));
    await reg.withService(a, a, async () => {});
    await vi.advanceTimersByTimeAsync(10);
    await reg.withService(b, b, async () => {});
    await vi.advanceTimersByTimeAsync(10);
    const held = await reg.acquire(b, b);
    await reg.withService(c, c, async () => {});
    expect(reg.peek(a)).toBeNull();
    expect(reg.peek(b)).toBe(held);
    expect(reg.peek(c)).not.toBeNull();
    reg.release(b);
  });

  it('terminates and restarts a project server and shuts everything down', async () => {
    const reg = registry();
    const a = join(root, 'a');
    const service = await reg.acquire(a, a);
    await service.acquireClient(async () => {});
    await reg.terminate(a);
    expect(clients[0].closed).toBe(true);
    expect(service.client).toBeNull();
    await reg.restartAfterBuild(a);
    expect(clients).toHaveLength(2);
    await reg.shutdown();
    expect(clients[1].closed).toBe(true);
    expect(reg.size).toBe(0);
    await expect(reg.acquire(a, a)).rejects.toThrow(/shut down/);
  });
});
