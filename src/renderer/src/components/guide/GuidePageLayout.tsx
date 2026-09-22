import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import { guideTopics } from '@/components/guide/topics';
import { cn } from '@/lib/utils';

/**
 * Shared shell for the guide pages: the app header, a sticky left-hand nav,
 * article content, and footer. `slug` marks the active topic.
 */

const navLinkClass =
  'block px-3 py-2 rounded-[6px] text-[0.8125rem] font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muted-foreground';

function GuideNavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        navLinkClass,
        active
          ? 'text-foreground bg-muted'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      {children}
    </Link>
  );
}

export default function GuidePageLayout({
  slug = '',
  children,
}: {
  slug?: string;
  children?: ReactNode;
}) {
  return (
    <div className="h-screen overflow-y-auto flex flex-col bg-background">
      <AppHeader breadcrumbs={
        <div className="flex items-center gap-2 text-[0.9375rem]">
          <span className="text-muted-foreground" aria-hidden="true">/</span>
          <Link to="/guide" className="font-semibold text-foreground transition-colors hover:text-primary">Guide</Link>
        </div>
      } />

      <div className="flex-1 w-full max-w-[1120px] mx-auto px-6 pt-10 pb-16 flex items-start gap-12 max-md:flex-col max-md:gap-6">
        <aside className="flex-shrink-0 w-[200px] sticky top-24 max-md:static max-md:w-full">
          <nav aria-label="Guide topics" className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">
            <GuideNavLink to="/guide" active={slug === ''}>
              Overview
            </GuideNavLink>
            {guideTopics.map((topic) => (
              <GuideNavLink
                key={topic.slug}
                to={`/guide/${topic.slug}`}
                active={slug === topic.slug}
              >
                {topic.label}
              </GuideNavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 w-full max-w-[760px]">
          <article className="[&_h2]:tracking-tight [&_h3]:tracking-tight">{children}</article>
        </main>
      </div>

      <AppFooter />
    </div>
  );
}
