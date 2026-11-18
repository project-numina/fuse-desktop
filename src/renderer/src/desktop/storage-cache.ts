import type { LocalApi, StorageUsage } from '@shared/desktop';
import { MemoryResource } from '@/lib/memory-resource';

let caches = new WeakMap<LocalApi['storage'], MemoryResource<StorageUsage>>();
export function storageCache(storage: LocalApi['storage']) {
  let cache = caches.get(storage);
  if (!cache) {
    cache = new MemoryResource(() => storage.usage(), 30_000);
    caches.set(storage, cache);
  }
  return cache;
}
export function resetStorageCache() { caches = new WeakMap(); }
