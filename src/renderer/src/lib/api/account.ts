/**
 * Account API helpers.
 *
 * The desktop app has a single local user, so only the current-user lookup
 * survives: `/auth/me` answers with a synthetic user built from the OS
 * account and the display name in Settings. Sign-in, sign-out, web-push
 * subscriptions, linked Claude accounts and access requests have no local
 * meaning and were removed with their pages.
 */

import { request } from '@/lib/api/core';

/** @return {Promise<Object>} Current user info. */
export function fetchCurrentUser(): Promise<unknown> {
  return request('/auth/me');
}
