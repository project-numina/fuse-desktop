/**
 * "N hidden" notice with a hover/focus tooltip explaining why generated
 * metadata files are omitted from the diff views.
 *
 * The `?` badge exposes the tooltip on hover and keyboard focus.
 */
export interface HiddenFilesNoticeProps {
  count: number;
  tooltip: string;
}

function HiddenFilesNotice({ count, tooltip }: HiddenFilesNoticeProps) {
  return (
    <p className="my-[var(--space-3)] shrink-0 text-center text-xs text-[var(--text-muted)]">
      {count} hidden
      <span
        className="group relative ml-1.5 inline-flex items-center align-[-3px] outline-none"
        tabIndex={0}
        aria-label="Why are files hidden?"
      >
        <svg
          className="pointer-events-none h-3.5 w-3.5 text-[var(--code-header-text)] opacity-35 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="10" />
          <text
            x="10"
            y="14.5"
            textAnchor="middle"
            fill="var(--code-header-bg)"
            fontSize="13"
            fontWeight="700"
            fontFamily="sans-serif"
          >
            ?
          </text>
        </svg>
        <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 hidden w-max max-w-[240px] -translate-x-1/2 rounded-[var(--radius-sm)] border border-[var(--numina-border)] bg-[var(--numina-card-bg)] px-[var(--space-2)] py-[var(--space-1)] text-left text-xs font-normal leading-[1.4] text-[var(--text-muted)] shadow-[var(--numina-shadow)] [font-family:var(--numina-font-sans)] group-hover:block group-focus-visible:block">
          {tooltip}
        </span>
      </span>
    </p>
  );
}

export default HiddenFilesNotice;
