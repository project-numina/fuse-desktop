import type { WebContents } from 'electron';
import type { PageNavigationState } from '@shared/desktop';

type PageContents = Pick<WebContents, 'getURL' | 'navigationHistory'>;

/** Never traverse the initial blank document or leave Fuse's app origin. */
export function canNavigatePage(contents: PageContents, offset: number): boolean {
  if (offset !== -1 && offset !== 1) return false;
  const history = contents.navigationHistory;
  if (!history.canGoToOffset(offset)) return false;
  const entry = history.getEntryAtIndex(history.getActiveIndex() + offset);
  try {
    const current = new URL(contents.getURL());
    const target = new URL(entry.url);
    return /^https?:$/.test(current.protocol) && current.origin === target.origin;
  } catch { return false; }
}

export function navigatePage(contents: PageContents, offset: number): boolean {
  if (!canNavigatePage(contents, offset)) return false;
  contents.navigationHistory.goToOffset(offset);
  return true;
}

export function pageNavigationState(contents: PageContents, swipeEnabled: boolean): PageNavigationState {
  return { swipeEnabled, canGoBack: canNavigatePage(contents, -1), canGoForward: canNavigatePage(contents, 1) };
}
