import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AppErrorProvider, AppErrorBoundary, useAppError } from '@/state/app-error';
import { AuthProvider } from '@/state/auth';
import { ThemeProvider } from '@/state/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import AppErrorFallback from '@/components/layout/AppErrorFallback';
import SmallScreenWarning from '@/components/layout/SmallScreenWarning';
import DesktopIntegration from '@/desktop/DesktopIntegration';
import GlobalTextSize from '@/desktop/GlobalTextSize';
import PageSwipeNavigation from '@/desktop/PageSwipeNavigation';
import router from '@/router';

// Below these dimensions the layout breaks down; we show a dedicated warning.
// The main process sets a matching minimum window size, so this mostly guards
// against window managers that ignore it.
const MIN_VIEWPORT_WIDTH = 1024;
const MIN_VIEWPORT_HEIGHT = 500;

function isViewportTooSmall(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.innerWidth < MIN_VIEWPORT_WIDTH ||
    window.innerHeight < MIN_VIEWPORT_HEIGHT
  );
}

/** Tracks the viewport so the small-window overlay follows resizes. */
function useShouldShowSmallScreenWarning(): boolean {
  const [tooSmall, setTooSmall] = useState(isViewportTooSmall);

  useEffect(() => {
    const update = () => setTooSmall(isViewportTooSmall());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return tooSmall;
}

/**
 * Renders `<AppErrorFallback>` in place of router content when a global error
 * exists; otherwise the router. The small-screen warning overlays both.
 */
function AppShell() {
  const { error } = useAppError();
  const showSmallScreenWarning = useShouldShowSmallScreenWarning();

  return (
    <>
      {/*
        Native-shell glue lives beside the router (not inside it) so menu
        commands keep working while an error fallback is shown, and it drives
        navigation through the data router object directly.
      */}
      <DesktopIntegration router={router} />
      <GlobalTextSize />
      <PageSwipeNavigation router={router} />
      {error !== null ? (
        <AppErrorFallback message={error} />
      ) : (
        /*
          Render-time errors bubble to this boundary, whose componentDidCatch
          sets the app-error store; that flips `error` above and this branch
          (fallback={null}) unmounts in favor of the single AppErrorFallback,
          so the two error paths never render two fallbacks at once.
        */
        <AppErrorBoundary fallback={null}>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      )}
      {showSmallScreenWarning && (
        <div className="fixed inset-0 z-[10000]">
          <SmallScreenWarning />
        </div>
      )}
    </>
  );
}

/**
 * Application root: wires the global context providers (error, auth, theme)
 * and the root shell around the React Router data router.
 */
export default function App() {
  return (
    <AppErrorProvider>
      <AuthProvider>
        <ThemeProvider>
          <TooltipProvider>
            <AppShell />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </AppErrorProvider>
  );
}
