/**
 * `/api/auth/*`: the local user stub. There is no sign-in on the desktop;
 * `/me` describes the person at the keyboard so the frontend's AuthProvider
 * initialises, and the web's account extras answer with empty values.
 */

import { userInfo } from 'node:os';
import { Hono } from 'hono';
import type { AuthUserResponse, PushConfigResponse } from '@shared/api-types';
import type { AppContext } from '../context';

export function localUser(ctx: AppContext): AuthUserResponse {
  const displayName = ctx.settings.get().displayName.trim();
  let username: string;
  try {
    username = userInfo().username;
  } catch {
    username = '';
  }
  return {
    github_username: displayName || username || 'local',
    name: displayName || null,
    github_avatar_url: null,
    is_admin: false,
    can_use_oauth_token: false,
    user_group: 'numina',
    can_configure_orchestrator_concurrency: false,
    orchestrator_concurrency_max: 1,
  };
}

export const PUSH_CONFIG: PushConfigResponse = { enabled: false, vapid_public_key: null };

export function authRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.get('/me', (c) => c.json(localUser(ctx)));
  app.get('/me/push-config', (c) => c.json(PUSH_CONFIG));
  app.post('/logout', (c) => c.body(null, 204));
  // Hosted-only account features: answer with "nothing configured".
  app.get('/claude-oauth-accounts', (c) => c.json([]));
  app.get('/claude-oauth-fallback', (c) => c.json({ automatic_api_key_fallback: false }));
  app.get('/tokens', (c) => c.json([]));
  app.get('/access-request/status', (c) => c.json({ status: 'approved' }));
  return app;
}
