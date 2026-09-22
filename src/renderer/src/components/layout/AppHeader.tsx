import type { ReactNode } from 'react';
import { Link, useNavigation } from 'react-router-dom';
import { useAuth } from '@/state/auth';
import AppHeaderUtilities from '@/components/layout/AppHeaderUtilities';
import ThemeToggle from '@/components/layout/ThemeToggle';
import HeaderIcon from './HeaderIcon';
import { headerControlClass } from './header-control';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/**
 * Global app header: brand link, nav icon links (guide,
 * appearance, chats and settings). `breadcrumbs` and `actions` are optional
 * render slots; the animated navigation-progress bar is driven by the
 * router's navigation state or the page's own `loading` flag.
 */
export default function AppHeader({
  breadcrumbs,
  actions,
  loading = false,
}: {
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  /** Show the top progress bar for page-owned async work. */
  loading?: boolean;
}) {
  const { user } = useAuth();
  const navigation = useNavigation();
  const isSignedIn = user !== null;
  const navigating = loading || navigation.state !== 'idle';

  const iconLinkClass = headerControlClass;

  return (
    <header className="sticky top-0 z-10 flex-shrink-0 border-b border-[var(--numina-border-light)] bg-card px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/numina_logo.svg" alt="Numina" className="w-8 h-8" />
            <span className="font-sans text-[0.9375rem] font-bold text-[var(--text-primary)]">
              Numina Fuse
            </span>
          </Link>
          {breadcrumbs}
        </div>
        <div className="flex items-center gap-2">
          {isSignedIn && (
            <Tooltip>
              <TooltipTrigger
                render={<Link to="/guide" className={iconLinkClass} aria-label="Guide" />}
              >
                <HeaderIcon name="guide" />
              </TooltipTrigger>
              <TooltipContent>Guide</TooltipContent>
            </Tooltip>
          )}
          <ThemeToggle />
          {actions}
          {isSignedIn && <AppHeaderUtilities />}
        </div>
      </div>
      {navigating && (
        <div
          className="absolute bottom-0 left-0 h-0.5 w-full overflow-hidden"
          aria-hidden="true"
        >
          <div className="navigation-progress-indicator" />
        </div>
      )}
    </header>
  );
}
