import { cn } from '@/lib/utils';

/** Shared alignment and interaction styles for workspace navigation actions. */
export function sidebarItemClass(active = false, extra?: string): string {
  return cn(
    'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium leading-[1.5] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'bg-[var(--accent-overlay-soft)] text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    extra,
  );
}
