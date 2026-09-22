import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const baseClass =
  'flex min-h-full flex-1 flex-col items-center justify-center p-[var(--space-4)] text-center text-sm text-[var(--text-muted)]';

interface GitPaneStateProps {
  children: ReactNode;
  spacious?: boolean;
}

function GitPaneState({ children, spacious = false }: GitPaneStateProps) {
  return (
    <div className={cn(baseClass, spacious && 'px-[var(--space-6)] py-[var(--space-8)]')}>
      {children}
    </div>
  );
}

export default GitPaneState;
