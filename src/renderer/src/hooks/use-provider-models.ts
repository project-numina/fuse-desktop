import { useEffect, useState } from 'react';
import type { ProviderId } from '@shared/agent-events';
import type { AppSettings, ModelOption } from '@shared/desktop';
import { desktopApi } from '@/desktop/bridge';

export type ProviderModels = { status: 'loading' | 'ready' | 'unavailable'; models: ModelOption[] };

/** Main-process caching shares probes; path changes refresh mounted pickers. */
export function useProviderModels(provider: ProviderId): ProviderModels {
  const [state, setState] = useState<ProviderModels>({ status: 'loading', models: [] });
  useEffect(() => {
    const api = desktopApi();
    let generation = 0;
    let path: string | undefined;
    const refresh = () => {
      const current = ++generation;
      setState({ status: 'loading', models: [] });
      Promise.resolve().then(() => {
        if (!api) throw new Error('Model listing needs the desktop app.');
        return api.providers.models(provider);
      }).then(
        models => { if (current === generation) setState({ status: 'ready', models }); },
        () => { if (current === generation) setState({ status: 'unavailable', models: [] }); },
      );
    };
    const onSettings = (settings: AppSettings) => {
      const next = (provider === 'claude' ? settings.claudePath : settings.codexPath).trim();
      if (next === path) return;
      path = next;
      refresh();
    };
    // Subscribe before reading so an older settings read cannot undo a path change.
    let changed = false;
    const unsubscribe = api?.settings.onChanged(settings => { changed = true; onSettings(settings); });
    void api?.settings.get().then(settings => {
      if (!changed) path = (provider === 'claude' ? settings.claudePath : settings.codexPath).trim();
    }).catch(() => undefined);
    refresh();
    return () => { generation++; unsubscribe?.(); };
  }, [provider]);
  return state;
}
