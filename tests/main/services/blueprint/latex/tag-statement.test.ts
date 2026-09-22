import { describe, expect, it } from 'vitest';
import { applyEdits } from '@main/services/blueprint/latex/tag-edits';
import {
  containsStandaloneLeanok,
  ownerLabel,
  statementEdits,
} from '@main/services/blueprint/latex/tag-statement';
import { declarationTags } from '@main/services/blueprint/latex/tags';

describe('statement tag grammar', () => {
  it('finds the owner outside nested declaration spans', () => {
    const source = '\\label{outer}\n\\label{inner}\n';
    const inner = source.indexOf('\\label{inner}');
    expect(ownerLabel(source, 0, source.length, [[inner, source.length]])).toBe('outer');
  });

  it('replaces a contiguous owned block in canonical order', () => {
    const source = '\\begin{lemma}\n  \\label{lem:x}\n  \\leanok\n  Statement.\n\\end{lemma}\n';
    const bodyStart = source.indexOf('\n') + 1;
    const bodyEnd = source.indexOf('\\end{lemma}');
    const edits = statementEdits(
      source,
      bodyStart,
      bodyEnd,
      [],
      [],
      'lem:x',
      declarationTags({ leanName: 'Demo.x', leanFile: 'Demo/X.lean', uses: ['def:y'], leanok: true }),
      '\n',
    );
    expect(edits).not.toBeNull();
    expect(applyEdits(source, edits ?? [])).toContain(
      '  \\lean{Demo.x}\n  \\leanfile{Demo/X.lean}\n  \\uses{def:y}\n  \\leanok\n',
    );
  });

  it('recognizes only standalone leanok commands', () => {
    expect(containsStandaloneLeanok('\\leanok\n')).toBe(true);
    expect(containsStandaloneLeanok('\\leanokay\n')).toBe(false);
  });
});
