/**
 * Parses unified-diff text into structured rows for side-by-side rendering.
 *
 * Instead of dumping raw unified-diff text, the Git views render each line as a
 * row with old/new line-number gutters. This parser strips the file metadata
 * headers (``diff --git``, ``index``, ``---``, ``+++``, mode/rename lines) that
 * leak the underlying git format and add no value once the per-file path is
 * already shown above the diff.
 */

export type StructuredLineKind =
  | 'context'
  | 'add'
  | 'remove'
  | 'hunk'
  | 'no-newline';

export interface StructuredLine {
  kind: StructuredLineKind;
  text: string;
  oldNum: number | null;
  newNum: number | null;
}

const METADATA_PREFIXES = [
  'diff --git',
  'index ',
  '--- ',
  '+++ ',
  'new file mode',
  'deleted file mode',
  'old mode',
  'new mode',
  'similarity index',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
];

function isMetadataLine(line: string): boolean {
  return METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}

export function parseStructuredDiff(diffText: string): StructuredLine[] {
  const rows: StructuredLine[] = [];
  let oldNum = 0;
  let newNum = 0;
  let inHunk = false;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('@@')) {
      // ``@@ -<old>[,<count>] +<new>[,<count>] @@`` — only the start
      // numbers matter for the counters; the counts are derived from
      // the actual hunk lines we walk through next.
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldNum = Number(match[1]);
        newNum = Number(match[2]);
      }
      rows.push({ kind: 'hunk', text: line, oldNum: null, newNum: null });
      inHunk = true;
      continue;
    }
    if (!inHunk || isMetadataLine(line)) continue;
    if (line.startsWith('\\')) {
      rows.push({ kind: 'no-newline', text: line, oldNum: null, newNum: null });
      continue;
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', text: line.slice(1), oldNum: null, newNum });
      newNum += 1;
      continue;
    }
    if (line.startsWith('-')) {
      rows.push({ kind: 'remove', text: line.slice(1), oldNum, newNum: null });
      oldNum += 1;
      continue;
    }
    // Context lines start with a leading space in unified diffs; an
    // empty line is also a context line with empty content.
    const text = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({ kind: 'context', text, oldNum, newNum });
    oldNum += 1;
    newNum += 1;
  }
  return rows;
}
