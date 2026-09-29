import { useEffect, useState } from 'react';
import type { ProviderId } from '@shared/agent-events';
import type { ModelOption } from '@shared/desktop';
import { desktopApi } from '@/desktop/bridge';

export type ProviderModels = { status: 'loading' | 'ready' | 'unavailable'; models: ModelOption[] };

const listings = new Map<ProviderId, Promise<ModelOption[]>>();

function fetchModels(provider: ProviderId): Promise<ModelOption[]> {
  const api = desktopApi();
  if (!api) return Promise.reject(new Error('Model listing needs the desktop app.'));
  let listing = listings.get(provider);
  if (!listing) {
    listing = api.providers.models(provider);
    listing.catch(() => listings.delete(provider));
    listings.set(provider, listing);
  }
  return listing;
}

/** Test seam: forget the listings fetched so far. */
export function resetProviderModels(): void {
  listings.clear();
}

/** The models the installed CLI reports, fetched once per provider. */
export function useProviderModels(provider: ProviderId): ProviderModels {
  const [state, setState] = useState<ProviderModels>({ status: 'loading', models: [] });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', models: [] });
    fetchModels(provider).then(
      (models) => { if (!cancelled) setState({ status: 'ready', models }); },
      () => { if (!cancelled) setState({ status: 'unavailable', models: [] }); },
    );
    return () => { cancelled = true; };
  }, [provider]);
  return state;
}
