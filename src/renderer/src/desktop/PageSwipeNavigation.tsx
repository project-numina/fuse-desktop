import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { PageNavigationState } from '@shared/desktop';
import type { ShellRouter } from './DesktopIntegration';
import { desktopApi } from './bridge';
import { installPageSwipe, type SwipeProgress } from './page-swipe';

export default function PageSwipeNavigation({ router }: { router: ShellRouter }) {
  const [progress, setProgress] = useState<SwipeProgress | null>(null);
  useEffect(() => {
    const navigation = desktopApi()?.navigation;
    if (!navigation) return;
    let active = true;
    let request = 0;
    const rootStyle = document.documentElement.style;
    const priorOverscroll = rootStyle.overscrollBehaviorX;
    let state: PageNavigationState = { swipeEnabled: false, canGoBack: false, canGoForward: false };
    const refresh = async () => {
      const id = ++request;
      try {
        const next = await navigation.state();
        if (active && request === id) {
          state = next;
          // Prevent Chromium from also interpreting an owned swipe as history navigation.
          rootStyle.overscrollBehaviorX = next.swipeEnabled ? 'none' : priorOverscroll;
        }
      } catch { /* Leave gestures disabled until the desktop bridge is ready. */ }
    };
    void refresh();
    const unsubscribe = router.subscribe(() => { void refresh(); });
    const removeSwipe = installPageSwipe(() => state, offset => { void navigation.go(offset).catch(() => {}); }, setProgress);
    window.addEventListener('focus', refresh);
    return () => { active = false; unsubscribe(); removeSwipe(); window.removeEventListener('focus', refresh); rootStyle.overscrollBehaviorX = priorOverscroll; };
  }, [router]);
  if (!progress) return null;
  const Icon = progress.offset === -1 ? ArrowLeft : ArrowRight;
  return <div aria-hidden="true" className={`pointer-events-none fixed top-1/2 z-[100] flex h-32 w-16 -translate-y-1/2 items-center justify-center bg-foreground/15 text-foreground backdrop-blur-sm ${progress.offset === -1 ? 'left-0 rounded-r-full pr-2' : 'right-0 rounded-l-full pl-2'}`}
    style={{ opacity: 0.4 + progress.progress * 0.6 }}><Icon className="size-8" strokeWidth={2} /></div>;
}
