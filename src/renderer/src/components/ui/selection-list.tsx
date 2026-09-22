import * as React from 'react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

function SelectionListSearch({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        'h-auto rounded-md bg-card px-3 py-2 focus-visible:border-primary focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  );
}

function SelectionList({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      role="listbox"
      className={cn('mb-4 flex max-h-48 flex-col gap-0.5 overflow-y-auto', className)}
      {...props}
    />
  );
}

function SelectionListEmpty({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('px-3 py-2 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

interface SelectionListItemProps extends React.ComponentProps<'button'> {
  selected?: boolean;
}

function SelectionListItem({
  className,
  selected = false,
  children,
  ...props
}: SelectionListItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:bg-accent focus-visible:text-primary focus-visible:outline-none',
        selected && 'bg-accent text-primary',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function SelectionIndicator({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      className={cn('h-4 w-4 flex-shrink-0 text-primary', className)}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <circle cx="10" cy="10" r="10" />
      <path
        d="M5.5 10.25l3 3 6-6"
        fill="none"
        stroke="var(--code-header-bg)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export {
  SelectionIndicator,
  SelectionList,
  SelectionListEmpty,
  SelectionListItem,
  SelectionListSearch,
};
