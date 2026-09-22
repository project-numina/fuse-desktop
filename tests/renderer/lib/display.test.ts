import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  declarationBorderStyle,
  formatDateTime,
  formatShortDateTime,
  formatUSD,
  kindBorderColor,
  kindLabel,
  lineNumberText,
  timeAgo,
  truncate,
} from '@/lib/display';

describe('display helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('formats declaration metadata and line numbers', () => {
    expect(kindLabel('theorem')).toBe('Theorem');
    expect(kindBorderColor('lemma')).toBe('#a78bfa');
    expect(kindBorderColor('unknown')).toBe('#fcd34d');
    expect(lineNumberText({ text: 'a\nb\nc', lineStart: 7 })).toBe('7\n8\n9');
    expect(declarationBorderStyle({ type: 'text' })).toEqual({});
    expect(declarationBorderStyle({
      type: 'decl', entry: { kind: 'theorem' }, declarationLineCount: 2,
    })).toEqual({
      borderLeft: '3px solid',
      borderImage: 'linear-gradient(to bottom, #60a5fa 2.4375rem, transparent 2.4375rem) 1',
    });
  });

  it('formats dates, money, relative time, and truncation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    expect(timeAgo('2026-07-11T01:00:00Z')).toBe('Today');
    expect(timeAgo('2026-07-10T01:00:00Z')).toBe('1 day ago');
    expect(timeAgo('2026-07-08T01:00:00Z')).toBe('3 days ago');
    expect(formatShortDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatUSD(null)).toBe('$0.00');
    expect(formatUSD(12.5)).toBe('$12.50');
    expect(truncate('abcdef', 4)).toBe('abcd…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
