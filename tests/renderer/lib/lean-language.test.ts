import { highlightTree, classHighlighter } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { lean } from '@/lib/lean-language';

describe('Lean CodeMirror language', () => {
  it('classifies keywords, names, numbers, strings, and comments', () => {
    const language = lean();
    const source = 'theorem answer : Nat := 42 -- proof';
    const classes: string[] = [];
    highlightTree(language.parser.parse(source), classHighlighter, (_from, _to, style) => classes.push(style));
    expect(classes).toContain('tok-keyword');
    expect(classes).toContain('tok-variableName');
    expect(classes).toContain('tok-number');
    expect(classes).toContain('tok-comment');
  });
});
