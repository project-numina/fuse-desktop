import { describe, expect, it } from 'vitest';
import { countDisplayLines, metadataLineCount } from '@/components/toolCalls/displayMetadata';

describe('tool display metadata', () => {
  it.each([['', 0], ['one', 1], ['one\ntwo', 2], ['one\ntwo\n', 2]])('counts lines in %j', (text, count) => {
    expect(countDisplayLines(text)).toBe(count);
  });
  it('reads finite authoritative line counts', () => {
    expect(metadataLineCount({ _fuse_display: { line_counts: { content: 309 } } }, 'content')).toBe(309);
  });
  it.each([
    [{}, null], [{ _fuse_display: [] }, null],
    [{ _fuse_display: { line_counts: [] } }, null],
    [{ _fuse_display: { line_counts: { content: '3' } } }, null],
    [{ _fuse_display: { line_counts: { content: Infinity } } }, null],
  ])('rejects malformed metadata', (input, expected) => {
    expect(metadataLineCount(input, 'content')).toBe(expected);
  });
});
