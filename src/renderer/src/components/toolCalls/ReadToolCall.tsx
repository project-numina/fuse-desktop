/**
 * Renderer for Read tool calls.
 * Shows the file path and optional line range.
 */

import { EMPTY_FILE_PATHS, resolveAvailableFilePath } from '@/lib/file-references';

interface ReadToolCallProps {
  tool: string;
  rawInput: Record<string, unknown>;
  availableFilePaths?: readonly string[];
  onOpenFile?: (filePath: string, line?: number) => void;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

export function ReadToolCall({
  tool,
  rawInput,
  availableFilePaths = EMPTY_FILE_PATHS,
  onOpenFile,
}: ReadToolCallProps) {
  const filePath = String(rawInput.file_path || rawInput.path || '');
  const shortPath = filePath.split('/').pop() || filePath;
  const offset = positiveInteger(rawInput.offset);
  const limit = positiveInteger(rawInput.limit);
  const openablePath = resolveAvailableFilePath(filePath, availableFilePaths);

  const lineRange =
    offset != null && limit != null
      ? `lines ${offset}–${offset + limit - 1}`
      : offset != null
        ? `from line ${offset}`
        : '';

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-semibold text-foreground">{tool}</span>
      {openablePath && onOpenFile ? (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-baseline gap-2 text-left text-muted-foreground transition-colors hover:text-[var(--numina-accent)] hover:underline focus-visible:rounded-sm focus-visible:text-[var(--numina-accent)] focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`Open ${openablePath}${offset ? ` at line ${offset}` : ''}`}
          title={openablePath}
          onClick={() => offset == null
            ? onOpenFile(openablePath)
            : onOpenFile(openablePath, offset)}
        >
          <span className="min-w-0 truncate">{shortPath}</span>
          {lineRange ? (
            <span className="shrink-0 text-[0.6875rem]">{lineRange}</span>
          ) : null}
        </button>
      ) : (
        <>
          <span
            className="min-w-0 truncate text-muted-foreground"
            title={filePath || undefined}
          >
            {shortPath}
          </span>
          {lineRange ? (
            <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{lineRange}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

export default ReadToolCall;
