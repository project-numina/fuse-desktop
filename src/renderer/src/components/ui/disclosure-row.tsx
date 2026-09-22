import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Shared with the troubleshooting guide: full-width rows, quiet dividers, right chevron. */
export function DisclosureRow({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return <details className="group/disclosure border-b border-border">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-muted-foreground">
      <span className="min-w-0 break-words">{title}</span>
      <span className="flex shrink-0 items-center gap-4">
        {meta && <span className="text-muted-foreground tabular-nums">{meta}</span>}
        <ChevronDown size={15} className="shrink-0 text-muted-foreground transition-transform group-open/disclosure:rotate-180" aria-hidden="true" />
      </span>
    </summary>
    <div className="pb-5 pr-6">{children}</div>
  </details>;
}
