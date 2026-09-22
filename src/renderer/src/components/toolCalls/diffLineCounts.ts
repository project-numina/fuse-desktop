/**
 * Line counts for an Edit tool call's rendered diff.
 *
 * `EditToolCall` renders `old_string` → `new_string` through
 * `unifiedMergeView`, which builds its chunks with `presentableDiff`. Counting
 * from the same function is what keeps the `+N -M` badge and the highlighted
 * rows below it describing the same edit: an Edit that rewrites one line inside
 * ten lines of surrounding context is `+1 -1`, not `+11 -11`.
 */

import { presentableDiff } from '@codemirror/merge';

export interface DiffLineCounts {
  added: number;
  removed: number;
}

/** Offsets at which each line of `text` starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** Index of the line containing `offset`, by binary search over `starts`. */
function lineIndexAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Collect the lines a set of character ranges touches.
 *
 * Ranges are half-open. An empty range is a pure insertion (or deletion) on the
 * other side and touches no line here. Boundary line breaks are structural: a
 * leading break starts the following changed line, while a trailing break ends
 * the preceding changed line. Counting either break as part of its neighbouring
 * unchanged line makes an append like `two` -> `two\nthree` report two added
 * lines. Consecutive boundary breaks still count because they represent changed
 * blank lines.
 *
 * Counting into a set rather than summing per range matters because two
 * adjacent changes can land on the same line, and that line must not count
 * twice.
 */
function touchedLineCount(
  text: string,
  ranges: readonly { from: number; to: number }[],
): number {
  if (!ranges.length) return 0;
  const starts = lineStarts(text);
  const lines = new Set<number>();
  for (const { from, to } of ranges) {
    if (to <= from) continue;
    const changedText = text.slice(from, to);
    const startsWithLineBreak = changedText.startsWith('\n');
    const endsWithLineBreak = changedText.endsWith('\n');
    let lineBreakCount = 0;
    for (
      let index = changedText.indexOf('\n');
      index !== -1;
      index = changedText.indexOf('\n', index + 1)
    ) {
      lineBreakCount += 1;
    }

    // A non-boundary range touches one more line than it contains breaks.
    // Leading/trailing breaks are separators rather than extra touched lines;
    // the break count remains the floor so changed blank lines are retained.
    const spannedLineCount = lineBreakCount + 1
      - Number(startsWithLineBreak)
      - Number(endsWithLineBreak);
    const affectedLineCount = Math.max(lineBreakCount, spannedLineCount);
    const firstLine = lineIndexAt(starts, from) + Number(startsWithLineBreak);
    const afterLastLine = Math.min(starts.length, firstLine + affectedLineCount);
    for (let line = firstLine; line < afterLastLine; line += 1) lines.add(line);
  }
  return lines.size;
}

/**
 * Count the lines an edit adds and removes.
 *
 * Both sides are counted independently: a line that changed is removed from the
 * old text and added to the new one, so a one-line rewrite reads `+1 -1`. Lines
 * that appear identically on both sides — the context the model quoted to
 * locate its edit — are in no change range and count for neither.
 */
export function diffLineCounts(oldText: string, newText: string): DiffLineCounts {
  if (!oldText && !newText) return { added: 0, removed: 0 };
  if (!oldText) return { added: countLines(newText), removed: 0 };
  if (!newText) return { added: 0, removed: countLines(oldText) };

  const changes = presentableDiff(oldText, newText);
  return {
    removed: touchedLineCount(oldText, changes.map((c) => ({ from: c.fromA, to: c.toA }))),
    added: touchedLineCount(newText, changes.map((c) => ({ from: c.fromB, to: c.toB }))),
  };
}

/** Lines in `text`, ignoring a single trailing newline. */
function countLines(text: string): number {
  if (!text) return 0;
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed.split('\n').length;
}
