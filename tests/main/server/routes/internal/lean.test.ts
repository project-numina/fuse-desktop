import { describe, expect, it, vi } from 'vitest';
import { loogleRemote } from '@main/server/routes/internal/lean';

describe('internal Loogle client', () => {
  it('encodes queries, normalizes hits, and enforces the requested limit', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ hits: [
      { name: 'Nat.add_comm', type: 'T', module: 'Nat' },
      { name: 12, type: null, module: 'Other' },
    ] }))) as unknown as typeof globalThis.fetch;

    await expect(loogleRemote('a + b', 1, fetch)).resolves.toEqual({ items: [{ name: 'Nat.add_comm', type: 'T', module: 'Nat' }] });
    expect(fetch).toHaveBeenCalledWith('https://loogle.lean-lang.org/json?q=a%20%2B%20b', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns no items for malformed payloads and wraps upstream failures', async () => {
    const malformed = vi.fn(async () => new Response('{}')) as unknown as typeof globalThis.fetch;
    await expect(loogleRemote('query', 8, malformed)).resolves.toEqual({ items: [] });
    const failed = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
    await expect(loogleRemote('query', 8, failed)).rejects.toMatchObject({ status: 502, code: 'loogle_failed', detail: 'loogle request failed: HTTP 503' });
  });
});
