import { useEffect } from 'react';
import { normalizeTextSize, TEXT_SCALES, type AppSettings } from '@shared/desktop';
import { desktopApi } from './bridge';

/** Scales rem-based typography app-wide without changing the browser zoom. */
export default function GlobalTextSize() {
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    let active = true;
    let changed = false;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--app-font-scale');
    const apply = (settings: AppSettings) => {
      if (active) root.style.setProperty('--app-font-scale', String(TEXT_SCALES[normalizeTextSize(settings.textSize)]));
    };
    const unsubscribe = api.settings.onChanged?.(settings => { changed = true; apply(settings); });
    void api.settings.get().then(settings => { if (!changed) apply(settings); }).catch(() => {});
    return () => {
      active = false; unsubscribe?.();
      if (previous) root.style.setProperty('--app-font-scale', previous);
      else root.style.removeProperty('--app-font-scale');
    };
  }, []);
  return null;
}
