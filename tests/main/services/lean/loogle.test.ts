import { describe, expect, it, vi } from 'vitest';
import { LeanToolError } from '@main/services/lean/lsp/service';
import { loogleRemote } from '@main/services/lean/loogle';

function fetchResponse(payload: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function fetchMock(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('loogleRemote', () => {
  it('encodes the query, sends the product header, and limits parsed hits', async () => {
    const fetchImpl = fetchMock(fetchResponse({
      hits: [
        { name: 'List.map', type: '(α → β) → List α → List β', module: 'Init.Data.List.Map' },
        { name: 'Array.map', type: '(α → β) → Array α → Array β', module: 'Init.Data.Array.Basic' },
      ],
    }));

    await expect(loogleRemote('?a → List a', 1, fetchImpl)).resolves.toEqual({
      items: [{ name: 'List.map', type: '(α → β) → List α → List β', module: 'Init.Data.List.Map' }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://loogle.lean-lang.org/json?q=%3Fa%20%E2%86%92%20List%20a',
      {
        headers: { 'User-Agent': 'fuse-desktop/0.1' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('normalizes malformed hits and keeps at least one result when the requested limit is zero', async () => {
    const fetchImpl = fetchMock(fetchResponse({ hits: [null, { name: 42, type: 'Nat', module: false }, 'bad'] }));

    await expect(loogleRemote('Nat', 0, fetchImpl)).resolves.toEqual({
      items: [{ name: '', type: '', module: '' }],
    });
  });

  it.each([null, [], {}, { hits: null }, { hits: {} }])('returns an empty list for a malformed payload: %j', async (payload) => {
    await expect(loogleRemote('x', 8, fetchMock(fetchResponse(payload)))).resolves.toEqual({ items: [] });
  });

  it('wraps HTTP, timeout, and JSON parsing failures as Lean tool errors', async () => {
    await expect(loogleRemote('x', 8, fetchMock(fetchResponse({}, { ok: false, status: 503 })))).rejects.toEqual(
      expect.objectContaining({ name: 'LeanToolError', message: 'loogle request failed: HTTP 503' }),
    );

    const timeoutFetch = vi.fn().mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError')) as unknown as typeof fetch;
    await expect(loogleRemote('x', 8, timeoutFetch)).rejects.toBeInstanceOf(LeanToolError);
    await expect(loogleRemote('x', 8, timeoutFetch)).rejects.toThrow('loogle request failed: The operation timed out');

    const badJson = fetchMock({ ok: true, status: 200, json: vi.fn().mockRejectedValue(new SyntaxError('bad JSON')) } as unknown as Response);
    await expect(loogleRemote('x', 8, badJson)).rejects.toThrow('loogle request failed: bad JSON');
  });
});
