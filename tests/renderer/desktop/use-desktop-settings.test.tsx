import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/desktop';

const bridge = vi.hoisted(() => ({ desktopApi: vi.fn() }));
vi.mock('@/desktop/bridge', () => bridge);

import { useDesktopSettings } from '@/desktop/use-desktop-settings';
import { resetSettingsCache } from '@/desktop/settings-cache';

const fuse = {
  settings: { get: vi.fn(), update: vi.fn() },
  providers: { detect: vi.fn() },
};

describe('useDesktopSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsCache();
    bridge.desktopApi.mockReturnValue(fuse);
    fuse.settings.get.mockResolvedValue({ ...DEFAULT_SETTINGS, displayName: 'Ada' });
    fuse.settings.update.mockImplementation(async (patch) => ({ ...DEFAULT_SETTINGS, ...patch }));
    fuse.providers.detect.mockResolvedValue([{ id: 'claude', label: 'Claude Code', command: 'claude', available: true, version: '1', path: '/bin/claude', error: null }]);
  });

  it('is unavailable outside Electron', () => {
    bridge.desktopApi.mockReturnValue(null);
    const { result } = renderHook(() => useDesktopSettings());
    expect(result.current.state).toMatchObject({ available: false, settings: null, loading: false });
  });

  // `npm run dev` mounts under <React.StrictMode>, whose simulated unmount
  // must not strand the page in `loading` or double the CLI detection.
  it('resolves under StrictMode with a single load and detection', async () => {
    const { result } = renderHook(() => useDesktopSettings(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.state.settings?.displayName).toBe('Ada'));
    await waitFor(() => expect(result.current.state.providers).toHaveLength(1));
    expect(result.current.state.loading).toBe(false);
    expect(fuse.settings.get).toHaveBeenCalledOnce();
    expect(fuse.providers.detect).toHaveBeenCalledOnce();
  });

  it('loads settings and detects providers once, then saves patches', async () => {
    const { result } = renderHook(() => useDesktopSettings());
    expect(result.current.state.loading).toBe(true);
    await waitFor(() => expect(result.current.state.settings?.displayName).toBe('Ada'));
    await waitFor(() => expect(result.current.state.providers).toHaveLength(1));
    expect(fuse.settings.get).toHaveBeenCalledOnce();
    expect(fuse.providers.detect).toHaveBeenCalledOnce();

    let ok = false;
    await act(async () => { ok = await result.current.update({ displayName: 'Ada L.' }); });
    expect(ok).toBe(true);
    expect(result.current.state.settings?.displayName).toBe('Ada L.');

    fuse.settings.update.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { ok = await result.current.update({ displayName: 'x' }); });
    expect(ok).toBe(false);
    expect(result.current.state.error).toBe('Could not save settings.');
  });

  it('paints cached settings on return and does not re-run CLI detection', async () => {
    const first = renderHook(() => useDesktopSettings());
    await waitFor(() => expect(first.result.current.state.providers).toHaveLength(1));
    await act(async () => { await first.result.current.update({ displayName: 'Saved' }); });
    first.unmount();
    // A slow refresh cannot blank the previously saved page.
    fuse.settings.get.mockReturnValue(new Promise(() => {}));
    const second = renderHook(() => useDesktopSettings());
    expect(second.result.current.state.settings?.displayName).toBe('Saved');
    expect(second.result.current.state.loading).toBe(false);
    expect(second.result.current.state.providers).toHaveLength(1);
    await act(async () => {});
    expect(fuse.providers.detect).toHaveBeenCalledOnce();
    await act(async () => { await second.result.current.detect(); });
    expect(fuse.providers.detect).toHaveBeenCalledTimes(2);
  });
});
