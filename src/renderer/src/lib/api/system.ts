/**
 * System-level API helpers: the Lean 4 release tag list.
 *
 * The hosted deployment-status endpoint (and the maintenance banner that
 * polled it) has no local equivalent, so it is not part of this surface.
 */

import { request } from '@/lib/api/core';

export interface Lean4Tag {
  name: string;
}

/**
 * Fetch the Lean 4 release tags via the local backend, which proxies the
 * public leanprover/lean4 tag list and caches it in-process. Offline, the
 * backend answers with an empty list and the version picker degrades to
 * "Match Mathlib (recommended)".
 */
export function fetchLean4Tags(): Promise<Lean4Tag[]> {
  return request<Lean4Tag[]>('/lean-versions');
}
