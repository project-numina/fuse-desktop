/**
 * HTTP client for the local backend API.
 *
 * The client is split into per-domain modules under ``lib/api/``;
 * this file re-exports their public surface so ``@/lib/api`` imports
 * keep working. The shared request core (``request``, ``ApiError`` and
 * error normalization) lives in ``lib/api/core``.
 */

// `request` and `ApiError` are the only core symbols that were part of
// the original public surface; `fetchApi` and `ApiRequestOptions` stay
// internal to the client modules to preserve the existing API exactly.
export {
  request,
  ApiError,
  repoPath,
  blueprintPath,
} from '@/lib/api/core';
export * from '@/lib/api/account';
export * from '@/lib/api/repositories';
export * from '@/lib/api/system';
export * from '@/lib/api/blueprints';
export * from '@/lib/api/sessions';
