import { useCallback, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useClickOutside } from '@/hooks/use-click-outside';
import { chapterMenuFile, chapterMenuLabel } from '@/features/blueprint/lib/chapter-entries';
import MathText from '@/components/MathText';
import type { ChapterDescriptor } from '@/features/blueprint/hooks/chapter';

/**
 * Floating section selector.
 *
 * One consistent control for choosing which chapter of a multi-file blueprint
 * is in view, mounted once in the
 * blueprint content pane (bottom-right) and shown across the section-aware
 * modes (overview, graph, editor).
 *
 * It takes the chapter descriptors and active path as props and reports the
 * chosen path via `onSelect` — the page applies it (so a pending editor save
 * can be flushed first). Display labels come from `chapterMenuLabel`.
 *
 * Labels are rendered through `MathText` and the shared `renderMath` (KaTeX)
 * pipeline with KaTeX-sanitized output (`trust: false`, `throwOnError: false`),
 * never raw user HTML.
 */
export interface SectionSelectorProps {
  /** All chapters for the current blueprint, in display order. */
  chapters: ChapterDescriptor[];
  /** Path of the currently active chapter. */
  activePath: string;
  /** Invoked with the chosen chapter path (only when it changes). */
  onSelect: (path: string) => void;
}

function SectionSelector({ chapters, activePath, onSelect }: SectionSelectorProps) {
  const items = useMemo(
    () =>
      chapters.map((entry, index) => ({
        path: entry.path,
        label: chapterMenuLabel(entry),
        file: chapterMenuFile(entry),
        isEntrypoint: entry.isEntrypoint,
        number: entry.isEntrypoint ? null : index,
      })),
    [chapters],
  );

  const activeLabel = useMemo(
    () => items.find((item) => item.path === activePath)?.label ?? 'Sections',
    [items, activePath],
  );

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(rootRef, close, { enabled: open });

  function handleSelect(path: string) {
    close();
    if (path !== activePath) onSelect(path);
  }

  return (
    <div
      ref={rootRef}
      className="absolute right-4 bottom-4 z-[6] flex w-60 max-w-[calc(100%-2rem)] flex-col items-stretch"
    >
      {open && (
        <div
          role="menu"
          className="mb-1.5 flex max-h-[60vh] flex-col overflow-y-auto rounded-md border border-border bg-card shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.path}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(item.path)}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-[0.1rem] px-3 py-[0.4rem] text-left text-sm leading-[1.5] text-foreground transition-colors hover:bg-[var(--numina-border-light)] hover:text-primary focus-visible:bg-[var(--numina-border-light)] focus-visible:text-primary focus-visible:outline-none',
                item.path === activePath && 'font-medium text-primary',
                item.isEntrypoint && 'border-b border-border italic',
              )}
            >
              <span className="flex min-w-0 items-baseline">
                {item.number !== null && (
                  <span className="mr-[0.35em] shrink-0">{item.number}.</span>
                )}
                <MathText text={item.label} />
              </span>
              {item.file && (
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-[family-name:var(--numina-font-mono)] text-xs leading-[1.5] text-muted-foreground">
                  {item.file}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Choose section"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-[0.7rem] py-[0.4rem] text-left text-sm font-medium leading-[1.5] text-foreground shadow-sm transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-overlay-soft)] aria-expanded:border-primary"
      >
        <svg
          className="shrink-0 text-muted-foreground"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <line x1="2.5" y1="3.5" x2="11.5" y2="3.5" />
          <line x1="2.5" y1="7" x2="11.5" y2="7" />
          <line x1="2.5" y1="10.5" x2="11.5" y2="10.5" />
        </svg>
        <MathText
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          text={activeLabel}
        />
        <span className="shrink-0 text-[0.625rem] leading-none opacity-70" aria-hidden="true">
          ▾
        </span>
      </button>
    </div>
  );
}

export default SectionSelector;
