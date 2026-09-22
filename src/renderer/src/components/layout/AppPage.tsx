import type { ReactNode } from 'react';

import AppFooter from '@/components/layout/AppFooter';
import AppHeader from '@/components/layout/AppHeader';
import { cn } from '@/lib/utils';

const contentWidths = {
  md: 'max-w-4xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
} as const;

/** Standard signed-in page shell: scroll container, app header, content, and footer. */
export default function AppPage({
  children,
  breadcrumbs,
  headerActions,
  headerLoading = false,
  width = 'md',
  mainClassName,
}: {
  children: ReactNode;
  breadcrumbs?: ReactNode;
  headerActions?: ReactNode;
  headerLoading?: boolean;
  width?: keyof typeof contentWidths;
  mainClassName?: string;
}) {
  return (
    <div className="page-bg flex h-screen flex-col overflow-y-auto">
      <AppHeader
        breadcrumbs={breadcrumbs}
        actions={headerActions}
        loading={headerLoading}
      />
      <main
        className={cn('mx-auto w-full flex-1 p-6', contentWidths[width], mainClassName)}
      >
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
