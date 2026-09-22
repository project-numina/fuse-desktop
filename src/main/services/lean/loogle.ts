/** Loogle (loogle.lean-lang.org) type-signature search used by the `lean_loogle` tool. */

import { LeanToolError } from './lsp/service';

export interface LoogleResult {
  name: string;
  type: string;
  module: string;
}

export interface LoogleResults {
  items: LoogleResult[];
}

const LOOGLE_TIMEOUT_MS = 10_000;

export async function loogleRemote(query: string, numResults = 8, fetchImpl: typeof fetch = fetch): Promise<LoogleResults> {
  let payload: unknown;
  try {
    const response = await fetchImpl(`https://loogle.lean-lang.org/json?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'fuse-desktop/0.1' },
      signal: AbortSignal.timeout(LOOGLE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch (error) {
    throw new LeanToolError(`loogle request failed: ${(error as Error).message}`);
  }
  if (!payload || typeof payload !== 'object' || !('hits' in payload)) return { items: [] };
  const hits = (payload as { hits: unknown }).hits;
  if (!Array.isArray(hits)) return { items: [] };
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    items: hits.slice(0, Math.max(1, numResults)).map((hit) => {
      const record = (hit && typeof hit === 'object' ? hit : {}) as Record<string, unknown>;
      return { name: text(record.name), type: text(record.type), module: text(record.module) };
    }),
  };
}
