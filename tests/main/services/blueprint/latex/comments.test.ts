import { describe, expect, it } from 'vitest';
import {
  characterIsEscaped,
  iterLatexCommandLines,
  latexCommentStart,
  maskLatexComments,
  maskLatexInlineVerbs,
  splitLatexPhysicalLines,
  stripLatexComment,
} from '@main/services/blueprint/latex/comments';

describe('maskLatexComments', () => {
  it.each(['\x0b', '\x0c', '\x1c', '\x1d', '\x1e', '\x85', '\u2028', '\u2029'])(
    'runs a comment to the physical LF across separator %j',
    (separator) => {
      const source = `visible % hidden${separator}also hidden\nnext`;
      const masked = maskLatexComments(source);
      const lf = source.indexOf('\n');
      expect(masked.slice(0, 8)).toBe('visible ');
      expect(masked.slice(8, lf)).toBe(' '.repeat(lf - 8));
      expect(masked.slice(lf)).toBe('\nnext');
    },
  );

  it('preserves length and the CR of a CRLF pair', () => {
    const source = 'a % b\r\nc % d\r\n';
    const masked = maskLatexComments(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).toBe('a    \r\nc    \r\n');
  });

  it('keeps escaped percents and percent-encoded URL arguments', () => {
    expect(maskLatexComments('50\\% done % note')).toBe('50\\% done       ');
    expect(maskLatexComments('\\url{https://x.test/a%20b} \\label{x}')).toBe('\\url{https://x.test/a%20b} \\label{x}');
  });

  it('closes an escaped URL brace on the first real brace so a later percent is a comment', () => {
    const line = '\\url{https://example.test/\\{} % \\input{missing}';
    expect(latexCommentStart(line)).toBe(line.indexOf('%'));
  });
});

describe('stripLatexComment / characterIsEscaped', () => {
  it('strips a real comment but keeps an escaped percent', () => {
    expect(stripLatexComment('keep \\% percent % comment')).toBe('keep \\% percent ');
  });

  it('counts consecutive backslashes', () => {
    expect(characterIsEscaped('\\%', 1)).toBe(true);
    expect(characterIsEscaped('\\\\%', 2)).toBe(false);
    expect(characterIsEscaped('%', 0)).toBe(false);
  });
});

describe('splitLatexPhysicalLines', () => {
  it('splits only at LF, strips a trailing CR and drops the empty tail', () => {
    expect(splitLatexPhysicalLines('')).toEqual([]);
    expect(splitLatexPhysicalLines('a\r\nb\n')).toEqual(['a', 'b']);
    expect(splitLatexPhysicalLines('a\r\nb\n', true)).toEqual(['a\r\n', 'b\n']);
    expect(splitLatexPhysicalLines('a\x0cb\nc')).toEqual(['a\x0cb', 'c']);
  });
});

describe('maskLatexInlineVerbs / iterLatexCommandLines', () => {
  it('masks inline verbatim including its delimiters', () => {
    const line = 'x \\verb|\\input{a}| y';
    expect(maskLatexInlineVerbs(line)).toBe('x ' + ' '.repeat('\\verb|\\input{a}|'.length) + ' y');
    expect(maskLatexInlineVerbs('x \\verb*+a+ y')).toBe('x ' + ' '.repeat('\\verb*+a+'.length) + ' y');
  });

  it('hides opaque environments and comments while keeping line offsets', () => {
    const source = '\\begin{verbatim}\n\\input{one}\n\\end{verbatim} \\input{two} % \\input{three}\n\\input{four}\n';
    const lines = iterLatexCommandLines(source);
    expect(lines.map(([number]) => number)).toEqual([1, 2, 3, 4]);
    for (const [index, [, visible]] of lines.entries()) {
      expect(visible).toHaveLength(splitLatexPhysicalLines(source, true)[index].length);
    }
    expect(lines[1][1].trim()).toBe('');
    expect(lines[2][1]).toContain('\\input{two}');
    expect(lines[2][1]).not.toContain('three');
    expect(lines[3][1]).toContain('\\input{four}');
  });
});
