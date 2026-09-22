import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@main/server/context';
import { errorResponse } from '@main/server/errors';
import { registerInternalBlueprintRoutes } from '@main/server/routes/internal/blueprint';

describe('internal blueprint route registration', () => {
  it('registers the endpoint group while preserving service-unavailable errors', async () => {
    const app = new Hono();
    app.onError((error, context) => errorResponse(context, error));
    registerInternalBlueprintRoutes(app, { services: {} } as AppContext, vi.fn());

    const response = await app.request('/local/repo/bp/blueprint/summary', { method: 'POST' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      detail: 'The service is temporarily unavailable. Please try again.',
      code: 'service_unavailable',
    }));
  });
});
