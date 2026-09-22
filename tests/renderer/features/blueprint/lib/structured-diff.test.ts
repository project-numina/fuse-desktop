import { describe, expect, it } from 'vitest';

import { parseStructuredDiff } from '@/features/blueprint/lib/structured-diff';

describe('parseStructuredDiff', () => {
  it('parses gutters and strips git metadata', () => {
    const diff = [
      'diff --git a/foo b/foo',
      'index 1234567..89abcde 100644',
      '--- a/foo',
      '+++ b/foo',
      '@@ -1,3 +1,4 @@ heading',
      ' context line',
      '-removed line',
      '+added line',
      '+another added',
      ' trailing',
    ].join('\n');

    expect(parseStructuredDiff(diff)).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,4 @@ heading', oldNum: null, newNum: null },
      { kind: 'context', text: 'context line', oldNum: 1, newNum: 1 },
      { kind: 'remove', text: 'removed line', oldNum: 2, newNum: null },
      { kind: 'add', text: 'added line', oldNum: null, newNum: 2 },
      { kind: 'add', text: 'another added', oldNum: null, newNum: 3 },
      { kind: 'context', text: 'trailing', oldNum: 3, newNum: 4 },
    ]);
  });

  it('ignores content before the first valid hunk', () => {
    expect(parseStructuredDiff('not a diff\nstill not')).toEqual([]);
  });

  it('preserves malformed hunk text without resetting counters', () => {
    expect(parseStructuredDiff('@@ malformed @@\n+x')).toEqual([
      { kind: 'hunk', text: '@@ malformed @@', oldNum: null, newNum: null },
      { kind: 'add', text: 'x', oldNum: null, newNum: 0 },
    ]);
  });

  it('emits markers and blank context lines', () => {
    expect(parseStructuredDiff('@@ -1 +1 @@\n \n\\ No newline at end of file')).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@', oldNum: null, newNum: null },
      { kind: 'context', text: '', oldNum: 1, newNum: 1 },
      { kind: 'no-newline', text: '\\ No newline at end of file', oldNum: null, newNum: null },
    ]);
  });
});
