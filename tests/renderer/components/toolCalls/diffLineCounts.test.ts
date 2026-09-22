import { describe, expect, it } from 'vitest';

import { diffLineCounts } from '@/components/toolCalls/diffLineCounts';

describe('Edit diff line counts', () => {
  it('counts nothing when the strings are identical', () => {
    const text = 'one\ntwo\nthree';
    expect(diffLineCounts(text, text)).toEqual({ added: 0, removed: 0 });
  });

  it('counts a rewritten line once on each side', () => {
    expect(diffLineCounts('one\ntwo\nthree', 'one\nTWO\nthree')).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it('ignores the context lines a model quotes to locate its edit', () => {
    const context = Array.from({ length: 10 }, (_, i) => `context ${i}`).join('\n');
    const before = `${context}\noriginal line`;
    const after = `${context}\nrewritten line`;
    expect(diffLineCounts(before, after)).toEqual({ added: 1, removed: 1 });
  });

  it('counts a pure insertion with no removals', () => {
    expect(diffLineCounts('one\ntwo', 'one\nmiddle\ntwo')).toEqual({
      added: 1,
      removed: 0,
    });
  });

  it('counts a final line once when there is no trailing newline', () => {
    expect(diffLineCounts('one\ntwo', 'one\ntwo\nthree')).toEqual({
      added: 1,
      removed: 0,
    });
    expect(diffLineCounts('one\ntwo\nthree', 'one\ntwo')).toEqual({
      added: 0,
      removed: 1,
    });
  });

  it('counts changed blank lines at the end of a string', () => {
    expect(diffLineCounts('one', 'one\n\n')).toEqual({ added: 2, removed: 0 });
    expect(diffLineCounts('one\n\n', 'one')).toEqual({ added: 0, removed: 2 });
  });

  it('counts splitting or joining a line once on the changed side', () => {
    expect(diffLineCounts('onetwo', 'one\ntwo')).toEqual({ added: 1, removed: 0 });
    expect(diffLineCounts('one\ntwo', 'onetwo')).toEqual({ added: 0, removed: 1 });
  });

  it('counts a deleted whole line once, not twice', () => {
    expect(diffLineCounts('one\ntwo\nthree', 'one\nthree')).toEqual({
      added: 0,
      removed: 1,
    });
  });

  it('counts every line of a multi-line replacement', () => {
    expect(diffLineCounts('a\nold1\nold2\nb', 'a\nnew1\nnew2\nnew3\nb')).toEqual({
      added: 3,
      removed: 2,
    });
  });

  it('counts two edits separated by unchanged context independently', () => {
    const before = 'head\nfirst\nmiddle\nsecond\ntail';
    const after = 'head\nFIRST\nmiddle\nSECOND\ntail';
    expect(diffLineCounts(before, after)).toEqual({ added: 2, removed: 2 });
  });

  it('treats an empty side as a whole-string insertion or deletion', () => {
    expect(diffLineCounts('', 'one\ntwo')).toEqual({ added: 2, removed: 0 });
    expect(diffLineCounts('one\ntwo', '')).toEqual({ added: 0, removed: 2 });
    expect(diffLineCounts('', '')).toEqual({ added: 0, removed: 0 });
  });

  it('ignores a single trailing newline when a side is counted whole', () => {
    expect(diffLineCounts('', 'one\ntwo\n')).toEqual({ added: 2, removed: 0 });
  });

  it('reports the real edit size for a Lean proof rewritten inside its context', () => {
    // The shape that motivated this: one tactic line replaced, everything else
    // carried along so the Edit can find its anchor. The badge used to read
    // +10 -11 because it measured the two strings rather than the diff.
    const before = [
      'have hx0 : (0 : ℝ) < x := lt_of_lt_of_le zero_lt_one hx',
      '-- The Padé bound, cleared of denominators.',
      'have hlog : 0 ≤ Real.log x * (x + 1) - 2 * (x - 1) := by',
      '  have h := Real.le_log_one_add_of_nonneg (sub_nonneg.mpr hx)',
      '  rw [show 1 + (x - 1) = x from by ring]',
      '  linarith',
      'rw [div_le_iff₀ (by linarith : (0 : ℝ) < 2 * x), ← sub_nonneg,',
      '  show (x * Real.log x - (x - 1)) * (2 * x) - (x - 1) ^ 2',
      '      = (2 * x ^ 2 * A + (x - 1) ^ 3) / (x + 1) from by',
      '    field_simp',
      '    ring]',
    ].join('\n');
    const after = before.replace('  linarith', '  positivity');

    expect(diffLineCounts(before, after)).toEqual({ added: 1, removed: 1 });
  });

  it('counts text appended inside a line as an addition only', () => {
    // `presentableDiff` sees this as an insertion — the old text survives
    // intact — and `allowInlineDiffs` renders it as inline added text with no
    // deleted row. The badge matches that rather than the intuition that the
    // line was "changed".
    expect(diffLineCounts('  linarith', '  nlinarith [sq_nonneg (x - 1)]')).toEqual({
      added: 1,
      removed: 0,
    });
  });
});
