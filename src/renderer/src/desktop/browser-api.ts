import type { AppSettings, BrowserApi, DesktopApi } from '@shared/desktop';
import { request } from '@/lib/api/core';
import { authenticatedApiUrl } from '@/lib/local-auth';
import { pickServerDirectory } from './server-directory-picker';

export interface LocalServerInfo {
  platform: DesktopApi['platform'];
  dataPath: string;
  baseUrl: string;
}

/** One stable adapter per window, so caches and subscriptions share identity. */
export function createBrowserApi(): BrowserApi {
  const listeners = new Set<(settings: AppSettings) => void>();
  const publish = (settings: AppSettings) => {
    for (const listener of listeners) listener(settings);
    return settings;
  };
  const refresh = () => { void request<AppSettings>('/local/settings').then(publish).catch(() => {}); };
  return {
    providers: {
      detect: () => request('/local/providers'),
      models: provider => request(`/local/providers/${encodeURIComponent(provider)}/models`),
    },
    settings: {
      get: () => request('/local/settings'),
      update: async patch => publish(await request('/local/settings', { method: 'PATCH', body: JSON.stringify(patch) })),
      onChanged(listener) {
        if (!listeners.size) window.addEventListener('focus', refresh);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (!listeners.size) window.removeEventListener('focus', refresh);
        };
      },
    },
    storage: {
      info: () => request('/local/storage'),
      usage: () => request('/local/storage/usage'),
      async export() {
        const response = await fetch(authenticatedApiUrl('/api/local/storage/export'), { credentials: 'include' });
        if (!response.ok) throw new Error('Could not export local data.');
        const filename = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? 'fuse-data.json';
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        // Allow the browser to consume the object URL before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { downloaded: true, filename };
      },
    },
    dialog: { pickFolder: pickServerDirectory },
    shell: { async openExternal(url) { window.open(url, '_blank', 'noopener,noreferrer'); } },
    server: { info: () => request<LocalServerInfo>('/local/info') },
  };
}
