import type { StructuredLine } from '@/features/blueprint/lib/structured-diff';

/**
 * Renders parsed unified-diff rows with old/new line-number gutters.
 *
 * Each row is a 4-column grid
 * (old # | new # | marker | content); hunk headers and `\ No newline` markers
 * span the full width. Content soft-wraps so long source lines never need
 * horizontal scroll.
 */
export interface DiffRowsProps {
  lines: StructuredLine[];
}

function DiffRows({ lines }: DiffRowsProps) {
  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto [font-family:var(--numina-font-mono)] text-xs leading-[1.5] bg-[var(--numina-card-bg)]">
      {lines.map((row, index) => {
        if (row.kind === 'hunk') {
          return (
            <div
              key={index}
              className="my-0.5 grid grid-cols-[1fr] items-baseline border-y border-[var(--numina-border-light)] bg-[var(--numina-surface-sunken)]"
            >
              <span className="whitespace-pre-wrap px-3 py-0.5 font-semibold text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {row.text}
              </span>
            </div>
          );
        }
        if (row.kind === 'no-newline') {
          return (
            <div
              key={index}
              className="grid grid-cols-[1fr] items-baseline italic text-[var(--text-muted)]"
            >
              <span className="whitespace-pre-wrap px-3 py-0.5 font-semibold [overflow-wrap:anywhere]">
                {row.text}
              </span>
            </div>
          );
        }

        const isAdd = row.kind === 'add';
        const isRemove = row.kind === 'remove';
        return (
          <div
            key={index}
            className={[
              'grid grid-cols-[2.75em_2.75em_1.25em_1fr] items-baseline',
              isAdd && 'bg-[rgb(22_163_74/0.09)]',
              isRemove && 'bg-[rgb(220_38_38/0.09)]',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className={[
                'select-none px-2 text-right text-[var(--text-muted)] opacity-70',
                isAdd || isRemove ? 'bg-transparent' : 'bg-[var(--numina-card-bg)]',
              ].join(' ')}
            >
              {row.oldNum ?? ''}
            </span>
            <span
              className={[
                'select-none px-2 text-right text-[var(--text-muted)] opacity-70',
                isAdd || isRemove ? 'bg-transparent' : 'bg-[var(--numina-card-bg)]',
              ].join(' ')}
            >
              {row.newNum ?? ''}
            </span>
            <span
              className={[
                'select-none text-center font-semibold',
                isAdd
                  ? 'text-[var(--status-verified-text)]'
                  : isRemove
                    ? 'text-[var(--status-unformalized-text)]'
                    : 'text-[var(--text-muted)]',
              ].join(' ')}
            >
              {isAdd ? '+' : isRemove ? '-' : ''}
            </span>
            <span
              className={[
                'whitespace-pre-wrap pl-1 pr-2 [overflow-wrap:anywhere]',
                isAdd
                  ? 'text-[var(--status-verified-text)]'
                  : isRemove
                    ? 'text-[var(--status-unformalized-text)]'
                    : 'text-[var(--text-body)]',
              ].join(' ')}
            >
              {row.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default DiffRows;
