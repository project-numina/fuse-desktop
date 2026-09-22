import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, TEXT_SCALES, type AppSettings } from '@shared/desktop';
import GlobalTextSize from '@/desktop/GlobalTextSize';

const bridge = vi.hoisted(() => ({ desktopApi: vi.fn() }));
vi.mock('@/desktop/bridge', () => bridge);
beforeEach(() => { vi.clearAllMocks(); document.documentElement.style.removeProperty('--app-font-scale'); });

describe('global text size', () => {
  it('applies saved sizes to the document root and follows live updates', async () => {
    let changed!: (settings: AppSettings) => void;
    const unsubscribe = vi.fn();
    bridge.desktopApi.mockReturnValue({ settings: {
      get: async () => ({ ...DEFAULT_SETTINGS, textSize: 'large' }),
      onChanged: (listener: typeof changed) => { changed = listener; return unsubscribe; },
    } });
    const { unmount } = render(<GlobalTextSize />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe(String(TEXT_SCALES.large)));
    act(() => changed({ ...DEFAULT_SETTINGS, textSize: 'small' }));
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe(String(TEXT_SCALES.small));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('');
  });
  it('does not let an old initial read overwrite a newer selection', async () => {
    let changed!: (settings: AppSettings) => void;
    let resolve!: (settings: AppSettings) => void;
    bridge.desktopApi.mockReturnValue({ settings: {
      get: () => new Promise(done => { resolve = done; }),
      onChanged: (listener: typeof changed) => { changed = listener; return vi.fn(); },
    } });
    render(<GlobalTextSize />);
    await act(async () => { changed({ ...DEFAULT_SETTINGS, textSize: 'extra-large' }); resolve(DEFAULT_SETTINGS); });
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe(String(TEXT_SCALES['extra-large']));
  });
});
