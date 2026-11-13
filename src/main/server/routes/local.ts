import { Hono } from 'hono';
import { z } from 'zod';
import { detectProviders } from '../../agents/detect';
import { listModels } from '../../agents/models';
import { snapshotLocalData } from '../../data-export';
import { accessibleDirectory, listDirectories, readLocalStorageUsage } from '../../local-capabilities';
import type { AppContext } from '../context';
import { validationError } from '../errors';

const settingsPatch = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  textSize: z.enum(['small', 'default', 'large', 'extra-large']).optional(),
  claudePath: z.string().optional(),
  codexPath: z.string().optional(),
  displayName: z.string().optional(),
  aiCommitMessages: z.boolean().optional(),
  lastRoute: z.string().nullable().optional(),
  notifications: z.object({ completed: z.boolean().optional(), failed: z.boolean().optional(), permission: z.boolean().optional(), sound: z.boolean().optional() }).strict().optional(),
  agentDefaults: z.object({
    provider: z.enum(['claude', 'codex']).optional(),
    model: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional(),
    claude_permission_mode: z.enum(['manual', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
    codex_sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }).strict().optional(),
}).strict();

/** Authenticated equivalents of local settings, CLI and filesystem capabilities. */
export function localRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.get('/info', c => c.json({ platform: process.platform, dataPath: ctx.paths.userData, baseUrl: ctx.server?.baseUrl ?? '' }));
  app.get('/settings', c => c.json(ctx.settings.get()));
  app.patch('/settings', async c => {
    const result = settingsPatch.safeParse(await c.req.json().catch(() => null));
    if (!result.success) throw validationError('Invalid application settings.');
    // Nested settings are patches; materialise them before invoking the store.
    const previous = ctx.settings.get();
    const patch = result.data;
    const saved = ctx.settings.update({
      ...patch,
      agentDefaults: { ...previous.agentDefaults, ...patch.agentDefaults },
      notifications: { ...previous.notifications, ...patch.notifications },
    });
    return c.json(saved);
  });
  app.get('/providers', async c => {
    const { claudePath, codexPath } = ctx.settings.get();
    return c.json(await detectProviders({ claudePath, codexPath }));
  });
  app.get('/providers/:provider/models', async c => {
    const provider = c.req.param('provider');
    if (provider !== 'claude' && provider !== 'codex') throw validationError('Unknown agent provider.');
    const settings = ctx.settings.get();
    return c.json(await listModels(provider, provider === 'claude' ? settings.claudePath : settings.codexPath));
  });
  app.get('/storage', c => c.json({ path: ctx.paths.userData }));
  app.get('/storage/usage', async c => c.json(await readLocalStorageUsage(ctx)));
  app.get('/storage/export', c => {
    const snapshot = snapshotLocalData(ctx.paths.userData, ctx.settings.get());
    c.header('Content-Disposition', `attachment; filename="fuse-data-${new Date().toISOString().slice(0, 10)}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(snapshot);
  });
  app.get('/directories', async c => c.json(await listDirectories(c.req.query('path'), c.req.query('filter') ?? '')));
  app.post('/directories/validate', async c => {
    const body = await c.req.json().catch(() => null);
    return c.json({ path: await accessibleDirectory(body?.path) });
  });
  return app;
}
