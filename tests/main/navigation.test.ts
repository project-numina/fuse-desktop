import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { canNavigatePage, navigatePage, pageNavigationState } from '@main/navigation';

function contents(urls: string[], index: number) {
  const goToOffset = vi.fn();
  const page = {
    getURL: () => urls[index],
    navigationHistory: {
      canGoToOffset: (offset: number) => index + offset >= 0 && index + offset < urls.length,
      getActiveIndex: () => index,
      getEntryAtIndex: (i: number) => ({ url: urls[i] }),
      goToOffset,
    },
  } as unknown as WebContents;
  return { page, goToOffset };
}
describe('in-app history navigation', () => {
  it('uses real history for both directions and reports boundaries', () => {
    const { page, goToOffset } = contents(['http://localhost:5173/', 'http://localhost:5173/account', 'http://localhost:5173/guide'], 1);
    expect(pageNavigationState(page, true)).toEqual({ swipeEnabled: true, canGoBack: true, canGoForward: true });
    expect(navigatePage(page, -1)).toBe(true);
    expect(navigatePage(page, 1)).toBe(true);
    expect(goToOffset.mock.calls).toEqual([[-1], [1]]);
    expect(pageNavigationState(contents(['http://localhost:5173/'], 0).page, false)).toEqual({ swipeEnabled: false, canGoBack: false, canGoForward: false });
  });
  it('rejects blank pages, other origins, invalid offsets and absent history', () => {
    for (const target of ['about:blank', 'https://example.com/', 'file:///tmp/index.html', 'http://localhost:9999/']) {
      const { page, goToOffset } = contents([target, 'http://localhost:5173/'], 1);
      expect(navigatePage(page, -1)).toBe(false);
      expect(goToOffset).not.toHaveBeenCalled();
    }
    const { page } = contents(['http://localhost:5173/'], 0);
    for (const offset of [-1, 1, 0, 2, Number.NaN]) expect(canNavigatePage(page, offset)).toBe(false);
  });
});
