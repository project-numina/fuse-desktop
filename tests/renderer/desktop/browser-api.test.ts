import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/desktop';
import { createBrowserApi } from '@/desktop/browser-api';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('browser local API', () => {
  it('uses authenticated API requests for settings, providers, models, storage and server info', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => json(url.endsWith('/settings') ? DEFAULT_SETTINGS : []));
    vi.stubGlobal('fetch', fetch);
    const api = createBrowserApi();
    await api.settings.get(); await api.providers.detect(); await api.providers.models('codex');
    await api.storage.info(); await api.storage.usage(); await api.server.info();
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/api/local/settings', '/api/local/providers', '/api/local/providers/codex/models',
      '/api/local/storage', '/api/local/storage/usage', '/api/local/info',
    ]);
    expect(fetch.mock.calls.every(call => call[1].credentials === 'include')).toBe(true);
  });

  it('publishes saved settings and refreshes subscribers on focus, removing listeners on unsubscribe', async () => {
    const saved = { ...DEFAULT_SETTINGS, textSize: 'large' };
    const fetch = vi.fn().mockResolvedValue(json(saved));
    vi.stubGlobal('fetch', fetch);
    const api = createBrowserApi();
    const listener = vi.fn();
    const unsubscribe = api.settings.onChanged(listener);
    await api.settings.update({ textSize: 'large' });
    expect(listener).toHaveBeenCalledWith(saved);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ textSize: 'large' }) });
    fetch.mockResolvedValue(json(DEFAULT_SETTINGS));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(DEFAULT_SETTINGS));
    unsubscribe();
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('downloads an export without inventing a server destination path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Disposition': 'attachment; filename="backup.json"' } })));
    const create = vi.fn().mockReturnValue('blob:export');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const result = await createBrowserApi().storage.export();
    expect(result).toEqual({ downloaded: true, filename: 'backup.json' });
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('propagates HTTP failures without publishing an unsaved patch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"Invalid path"}', { status: 400 })));
    const api = createBrowserApi();
    const listener = vi.fn(); const unsubscribe = api.settings.onChanged(listener);
    await expect(api.settings.update({ codexPath: '/bad' })).rejects.toThrow('Invalid path');
    expect(listener).not.toHaveBeenCalled(); unsubscribe();
  });
});
