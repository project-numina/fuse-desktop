import { cn } from '@/lib/utils';
import type { ChapterDescriptor } from '@/features/blueprint/hooks/chapter';

/**
 * Horizontal chapter navigation rail for multi-file leanblueprints.
 *
 * The parent supplies the chapter descriptors and active path, and is notified of a
 * user pick via `onSelect`. The rail hides itself entirely when there is one
 * chapter or fewer (nothing to navigate between).
 */
export interface ChapterRailProps {
  /** All chapters for the current blueprint, in display order. */
  chapters: ChapterDescriptor[];
  /** Path of the currently active chapter. */
  activePath: string;
  /** Disable interaction (e.g. while an edit save is flushing). */
  disabled?: boolean;
  /** Invoked with the chapter path when the user selects a tab. */
  onSelect: (path: string) => void;
}

function ChapterRail({
  chapters,
  activePath,
  disabled = false,
  onSelect,
}: ChapterRailProps) {
  if (chapters.length <= 1) return null;

  return (
    <nav
      className="flex items-stretch overflow-x-auto border-b border-border bg-background px-4"
      aria-label="Blueprint chapters"
    >
      {chapters.map((chapter) => {
        const active = chapter.path === activePath;
        return (
          <button
            key={chapter.path}
            type="button"
            disabled={disabled}
            title={chapter.path}
            onClick={() => onSelect(chapter.path)}
            className={cn(
              'inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-3 py-2 font-mono text-xs transition-colors',
              'disabled:cursor-default disabled:opacity-50',
              active
                ? 'border-foreground text-foreground'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            <span>
              {chapter.isEntrypoint && (
                <span className="mr-1 text-muted-foreground">#</span>
              )}
              {chapter.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export default ChapterRail;
