import type { LocalApi } from '@shared/desktop';
import { MemoryResource } from '@/lib/memory-resource';

function createCache(api: LocalApi) {
  return {
    settings: new MemoryResource(() => api.settings.get(), 0),
    providers: new MemoryResource(() => api.providers.detect(), 60_000),
  };
}
// Bridge lifetime = window lifetime. At most one settings object and CLI list.
let caches = new WeakMap<LocalApi, ReturnType<typeof createCache>>();
export function settingsCache(api: LocalApi) {
  let cache = caches.get(api);
  if (!cache) { cache = createCache(api); caches.set(api, cache); }
  return cache;
}
export function resetSettingsCache() { caches = new WeakMap(); }
