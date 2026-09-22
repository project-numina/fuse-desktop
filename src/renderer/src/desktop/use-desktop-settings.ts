/**
 * Desktop preferences (`window.fuse.settings`) and CLI detection
 * (`window.fuse.providers.detect`) for the Settings page.
 *
 * Outside Electron the bridge is absent: `available` is false and the page
 * hides the desktop sections instead of showing dead controls.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, ProviderInfo } from '@shared/desktop';
import { desktopApi } from '@/desktop/bridge';
import { settingsCache } from './settings-cache';

export interface DesktopSettingsState {
  available: boolean;
  settings: AppSettings | null;
  providers: ProviderInfo[];
  /** True while the initial settings/provider load is running. */
  loading: boolean;
  /** True while a save or a re-detect is in flight. */
  saving: boolean;
  detecting: boolean;
  error: string | null;
}

export function useDesktopSettings() {
  const api = desktopApi();
  const available = api !== null;
  const cache = api ? settingsCache(api) : null;
  const [settings, setSettings] = useState<AppSettings | null>(() => cache?.settings.value ?? null);
  const [providers, setProviders] = useState<ProviderInfo[]>(() => cache?.providers.value ?? []);
  const [loading, setLoading] = useState(available && !cache?.settings.value);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    const bridge = desktopApi();
    if (!bridge) return;
    setDetecting(true);
    try {
      setProviders(await settingsCache(bridge).providers.read(true));
    } catch {
      setError('Could not check the installed CLIs.');
    } finally {
      setDetecting(false);
    }
  }, []);

  // Paint cached values immediately. Refresh settings on reveal; CLI detection
  // is shared and throttled rather than spawning processes on every page visit.
  useEffect(() => {
    if (!cache) return;
    let active = true;
    void cache.settings.read().then(value => { if (active) setSettings(value); })
      .catch(() => { if (active) setError('Could not load desktop settings.'); })
      .finally(() => { if (active) setLoading(false); });
    if (!cache.providers.value) setDetecting(true);
    void cache.providers.read().then(value => { if (active) setProviders(value); })
      .catch(() => { if (active) setError('Could not check the installed CLIs.'); })
      .finally(() => { if (active) setDetecting(false); });
    return () => { active = false; };
  }, [cache]);

  /**
   * Persist a partial update. `agentDefaults` is merged by the main process,
   * so callers may pass only the changed field of the nested object.
   */
  const update = useCallback(async (patch: Partial<AppSettings>): Promise<boolean> => {
    const bridge = desktopApi();
    if (!bridge) return false;
    setSaving(true);
    setError(null);
    try {
      const saved = await bridge.settings.update(patch);
      settingsCache(bridge).settings.set(saved);
      setSettings(saved);
      return true;
    } catch {
      setError('Could not save settings.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const state: DesktopSettingsState = {
    available,
    settings,
    providers,
    loading,
    saving,
    detecting,
    error,
  };
  return { state, update, detect };
}
