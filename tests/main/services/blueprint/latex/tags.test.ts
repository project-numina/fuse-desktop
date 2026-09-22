import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declarationStatus, parseBlueprintDeclarations } from '@main/services/blueprint/latex/blueprint';
import { setLatexWarningSink } from '@main/services/blueprint/latex/log';
import {
  applyEdits,
  declarationRewriteBatches,
  declarationTags,
  isInComment,
  rewriteProofLeanok,
  rewriteProofLeanokTags,
  rewriteTexTags,
  tagsFromDeclaration,
  type DeclarationTags,
} from '@main/services/blueprint/latex/tags';

let warnings: string[];

beforeEach(() => {
  warnings = [];
  setLatexWarningSink((message) => warnings.push(message));
});

afterEach(() => {
  setLatexWarningSink(null);
});

function tags(entries: Record<string, Partial<DeclarationTags>>): Map<string, DeclarationTags> {
  return new Map(Object.entries(entries).map(([label, overrides]) => [label, declarationTags(overrides)]));
}

function statuses(source: string): Record<string, string> {
  return Object.fromEntries(parseBlueprintDeclarations(source).map((entry) => [entry.label, declarationStatus(entry)]));
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('rewriteTexTags', () => {
  it('inserts the tag block after the label', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    Statement of the lemma.\n\\end{lemma}\n';
    const { source: result, matched } = rewriteTexTags(
      source,
      tags({ 'lem:helper': { leanName: 'Demo.helper', leanFile: 'Demo/Helper.lean', leanok: true } }),
    );
    expect(result).toBe(
      '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    \\lean{Demo.helper}\n    \\leanfile{Demo/Helper.lean}\n    \\leanok\n    Statement of the lemma.\n\\end{lemma}\n',
    );
    expect(matched).toEqual(new Set(['lem:helper']));
  });

  it('replaces an existing tag block wholesale', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    \\lean{Demo.old_name}\n    \\leanfile{Demo/Old.lean}\n    Statement.\n\\end{lemma}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'lem:helper': { leanName: 'Demo.new_name', leanFile: 'Demo/New.lean' } }));
    expect(result).toContain('\\lean{Demo.new_name}');
    expect(result).toContain('\\leanfile{Demo/New.lean}');
    expect(result).not.toContain('Demo.old_name');
    expect(result).not.toContain('Demo/Old.lean');
    expect(count(result, '\\lean{')).toBe(1);
    expect(count(result, '\\leanfile{')).toBe(1);
  });

  it('normalises the tag order', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    \\leanok\n    \\leanfile{Demo/Helper.lean}\n    \\lean{Demo.helper}\n    Statement.\n\\end{lemma}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'lem:helper': { leanName: 'Demo.helper', leanFile: 'Demo/Helper.lean', leanok: true } }));
    expect(result.indexOf('\\lean{')).toBeLessThan(result.indexOf('\\leanfile{'));
    expect(result.indexOf('\\leanfile{')).toBeLessThan(result.indexOf('\\leanok'));
  });

  it('is idempotent', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    Statement.\n\\end{lemma}\n';
    const requested = tags({ 'lem:helper': { leanName: 'Demo.helper', leanFile: 'Demo/Helper.lean', leanok: true } });
    const once = rewriteTexTags(source, requested).source;
    expect(rewriteTexTags(once, requested).source).toBe(once);
  });

  it('preserves an existing leanfile when the tags carry none', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    \\lean{Demo.helper}\n    \\leanfile{Demo/Helper.lean}\n    \\leanok\n    Statement.\n\\end{lemma}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'lem:helper': {} }));
    expect(result).not.toContain('\\lean{');
    expect(result).toContain('\\leanfile{Demo/Helper.lean}');
    expect(result).not.toContain('\\leanok');
    expect(result).toContain('Statement.');
  });

  it('leaves other declarations untouched', () => {
    const source = '\\begin{lemma}[A]\n    \\label{lem:a}\n    \\lean{Demo.a}\n    Statement A.\n\\end{lemma}\n\\begin{lemma}[B]\n    \\label{lem:b}\n    Statement B.\n\\end{lemma}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'lem:b': { leanName: 'Demo.b' } }));
    expect(result).toContain('\\lean{Demo.a}');
    expect(result).toContain('\\lean{Demo.b}');
    expect(matched).toEqual(new Set(['lem:b']));
  });

  it('preserves nested declaration leanok when rewriting an outer proof', () => {
    const source = [
      '\\begin{proposition}[Outer]\n',
      '    \\label{prop:outer}\n',
      '    Outer statement.\n',
      '\\end{proposition}\n',
      '\\begin{proof}\n',
      '    Outer proof introduction.\n',
      '    \\begin{theorem}[Nested A]\n',
      '        \\label{thm:nested-a}\n',
      '        \\lean{Demo.nestedA}\n',
      '        \\leanok\n',
      '        Nested statement A.\n',
      '    \\end{theorem}\n',
      '    \\begin{proof}\n',
      '        \\leanok\n',
      '        Nested proof A.\n',
      '    \\end{proof}\n',
      '    \\begin{lemma}[Nested B]\n',
      '        \\label{lem:nested-b}\n',
      '        \\lean{Demo.nestedB}\n',
      '        \\leanok\n',
      '        Nested statement B.\n',
      '    \\end{lemma}\n',
      '    \\begin{proof}\n',
      '        \\leanok\n',
      '        Nested proof B.\n',
      '    \\end{proof}\n',
      '    Outer proof conclusion.\n',
      '\\end{proof}\n',
      '\\begin{proposition}[Next]\n',
      '    \\label{prop:next}\n',
      '    Next statement.\n',
      '\\end{proposition}\n',
      '\\begin{proof}\n',
      '    Next proof.\n',
      '\\end{proof}\n',
    ].join('');
    const requested = tags({
      'prop:outer': { leanName: 'Demo.outer', leanok: true, proofLeanok: true },
      'prop:next': { leanName: 'Demo.next', leanok: true, proofLeanok: true },
    });
    expect(statuses(source)['prop:outer']).toBe('not_started');

    const { source: result, matched } = rewriteTexTags(source, requested);
    expect(matched).toEqual(new Set(['prop:outer', 'prop:next']));
    expect(statuses(result)).toEqual({
      'prop:outer': 'proved',
      'thm:nested-a': 'proved',
      'lem:nested-b': 'proved',
      'prop:next': 'proved',
    });
    expect(rewriteTexTags(result, requested).source).toBe(result);

    const downgrade = tags({ 'prop:outer': {}, 'thm:nested-a': {} });
    expect(declarationRewriteBatches(result, downgrade)).toHaveLength(2);
    const { source: downgraded, matched: downgradedMatched } = rewriteTexTags(result, downgrade);
    expect(downgradedMatched).toEqual(new Set(['prop:outer', 'thm:nested-a']));
    expect(statuses(downgraded)).toEqual({
      'prop:outer': 'not_started',
      'thm:nested-a': 'not_started',
      'lem:nested-b': 'proved',
      'prop:next': 'proved',
    });
    expect(rewriteTexTags(downgraded, downgrade).source).toBe(downgraded);
  });

  it('separates a linked proof nested in a targeted proof into its own pass', () => {
    const source = [
      '\\begin{lemma}[Linked]\n',
      '    \\label{lem:linked}\n',
      '    \\leanok\n',
      '    Linked statement.\n',
      '\\end{lemma}\n',
      '\\begin{theorem}[Outer]\n',
      '    \\label{thm:outer}\n',
      '    \\leanok\n',
      '    Outer statement.\n',
      '\\end{theorem}\n',
      '\\begin{proof}\n',
      '    \\leanok\n',
      '    Outer proof.\n',
      '    \\begin{proof}\n',
      '        \\proves{lem:linked}\n',
      '        \\leanok\n',
      '        Linked proof.\n',
      '    \\end{proof}\n',
      '\\end{proof}\n',
    ].join('');
    const requested = tags({ 'lem:linked': {}, 'thm:outer': { leanok: true, proofLeanok: true } });
    expect(declarationRewriteBatches(source, requested)).toHaveLength(2);
    const { source: result, matched } = rewriteTexTags(source, requested);
    expect(matched).toEqual(new Set(['lem:linked', 'thm:outer']));
    expect(statuses(result)).toEqual({ 'lem:linked': 'not_started', 'thm:outer': 'proved' });
    expect(rewriteTexTags(result, requested).source).toBe(result);
  });

  it('renders uses between leanfile and leanok', () => {
    const source = '\\begin{theorem}[Main]\n    \\label{thm:main}\n    Statement.\n\\end{theorem}\n';
    const { source: result } = rewriteTexTags(
      source,
      tags({ 'thm:main': { leanName: 'Demo.main', leanFile: 'Demo/Main.lean', uses: ['lem:a', 'lem:b'], leanok: true } }),
    );
    expect(result).toContain('\\uses{lem:a, lem:b}');
    expect(result.indexOf('\\leanfile{')).toBeLessThan(result.indexOf('\\uses{'));
    expect(result.indexOf('\\uses{')).toBeLessThan(result.indexOf('\\leanok'));
  });

  it('is a no-op for an empty map or an unknown label', () => {
    const source = '\\begin{lemma}[A]\n    \\label{lem:a}\n    Statement.\n\\end{lemma}\n';
    expect(rewriteTexTags(source, new Map())).toEqual({ source, matched: new Set() });
    expect(rewriteTexTags(source, tags({ 'lem:ghost': { leanName: 'Demo.ghost' } }))).toEqual({ source, matched: new Set() });
  });

  it('does not consume a proof uses', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    Statement.\n\\end{lemma}\n\\begin{proof}\n    \\uses{lem:other}\n    Proof body.\n\\end{proof}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'lem:helper': { leanName: 'Demo.helper', uses: ['lem:dep'] } }));
    expect(result).toContain('\\uses{lem:dep}');
    expect(result).toContain('\\uses{lem:other}');
  });

  it('does not corrupt an outer declaration around a nested one', () => {
    const source = '\\begin{theorem}[Outer]\n    \\label{thm:outer}\n    Outer statement.\n    \\begin{lemma}[Nested]\n        \\label{lem:nested}\n        Nested statement.\n    \\end{lemma}\n    More outer text.\n\\end{theorem}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'thm:outer': { leanName: 'Demo.outer', leanok: true } }));
    expect(count(result, '\\begin{lemma}')).toBe(1);
    expect(count(result, '\\end{lemma}')).toBe(1);
    expect(count(result, 'Nested statement.')).toBe(1);
    expect(count(result, 'More outer text.')).toBe(1);
    expect(result).toContain('\\lean{Demo.outer}');
    expect(result).toContain('\\leanok');
    expect(matched).toEqual(new Set(['thm:outer']));
  });

  it('rewrites a nested label in the same call', () => {
    const source = '\\begin{theorem}[Outer]\n    \\label{thm:outer}\n    Outer statement.\n    \\begin{lemma}[Nested]\n        \\label{lem:nested}\n        Nested statement.\n    \\end{lemma}\n\\end{theorem}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'thm:outer': { leanName: 'Demo.outer' }, 'lem:nested': { leanName: 'Demo.nested' } }));
    expect(count(result, '\\lean{Demo.outer}')).toBe(1);
    expect(count(result, '\\lean{Demo.nested}')).toBe(1);
    expect(matched).toEqual(new Set(['thm:outer', 'lem:nested']));
  });

  it('does not report a typo label as matched', () => {
    const source = '\\begin{lemma}[Real]\n    \\label{lem:real}\n    Statement.\n\\end{lemma}\n';
    const { matched } = rewriteTexTags(source, tags({ 'lem:real': { leanName: 'Demo.real' }, 'lem:typo': { leanName: 'Demo.typo' } }));
    expect(matched).toEqual(new Set(['lem:real']));
  });
});

describe('tagsFromDeclaration', () => {
  it('maps statuses to the leanok flags', () => {
    const proved = tagsFromDeclaration({ leanDeclaration: 'Demo.proved', leanFile: 'Demo/Proved.lean', status: 'proved' });
    expect(proved.leanFile).toBe('');
    expect(proved.leanok).toBe(true);
    expect(proved.proofLeanok).toBe(true);
    const inProgress = tagsFromDeclaration({ leanDeclaration: 'Demo.helper', leanFile: 'Demo/Helper.lean', status: 'in_progress' });
    expect(inProgress.leanok).toBe(true);
    expect(inProgress.proofLeanok).toBe(false);
    const notStarted = tagsFromDeclaration({ leanDeclaration: 'Demo.helper', leanFile: 'Demo/Helper.lean', status: 'not_started' });
    expect(notStarted.leanok).toBe(false);
    expect(notStarted.proofLeanok).toBe(false);
    expect(tagsFromDeclaration({})).toEqual(declarationTags());
  });

  it('creates a missing proof only for a proof-required kind', () => {
    const theorem = tagsFromDeclaration({ kind: 'theorem', status: 'proved' });
    const definition = tagsFromDeclaration({ kind: 'definition', status: 'proved' });
    expect(theorem.proofLeanok).toBe(true);
    expect(theorem.createMissingProof).toBe(true);
    expect(definition.proofLeanok).toBe(true);
    expect(definition.createMissingProof).toBe(false);
  });

  it('keeps uses and flags a proof in another file', () => {
    const result = tagsFromDeclaration({
      kind: 'theorem',
      status: 'proved',
      uses: ['lem:a', '', 3, 'lem:b'],
      sourceFile: 'blueprint/src/content.tex',
      proofSourceFile: 'blueprint/src/proofs.tex',
    });
    expect(result.uses).toEqual(['lem:a', 'lem:b']);
    expect(result.proofInOtherFile).toBe(true);
    expect(tagsFromDeclaration({ uses: 'nope', sourceFile: 'a.tex', proofSourceFile: 'a.tex' }).proofInOtherFile).toBe(false);
  });
});

// --- proof-block \leanok ---

const THEOREM_AFTER_PROOF = '\\begin{theorem}[Main]\n    \\label{thm:main}\n    Statement.\n\\end{theorem}\n\\begin{proof}\n    Proof body.\n\\end{proof}\n';
const THEOREM_INSIDE_PROOF = '\\begin{theorem}[Main]\n    \\label{thm:main}\n    Statement.\n    \\begin{proof}\n        Proof body.\n    \\end{proof}\n\\end{theorem}\n';

function mainTags(proofLeanok: boolean): Map<string, DeclarationTags> {
  return tags({ 'thm:main': { leanName: 'Demo.main', leanok: true, proofLeanok } });
}

describe('proof-block leanok', () => {
  it('injects leanok into an after-env proof', () => {
    const { source: result } = rewriteTexTags(THEOREM_AFTER_PROOF, mainTags(true));
    const [body, proof] = result.split('\\end{theorem}');
    expect(proof).toContain('\\begin{proof}\n    \\leanok\n');
    expect(body).toContain('\\leanok');
  });

  it('injects leanok into an inside-env proof', () => {
    expect(rewriteTexTags(THEOREM_INSIDE_PROOF, mainTags(true)).source).toContain('\\begin{proof}\n        \\leanok\n');
  });

  it('strips the proof leanok on in_progress', () => {
    const proved = rewriteTexTags(THEOREM_AFTER_PROOF, mainTags(true)).source;
    const result = rewriteTexTags(proved, mainTags(false)).source;
    const [body, proof] = result.split('\\end{theorem}');
    expect(proof).not.toContain('\\leanok');
    expect(count(body, '\\leanok')).toBe(1);
  });

  it('does not duplicate the proof leanok on a second run', () => {
    const once = rewriteTexTags(THEOREM_AFTER_PROOF, mainTags(true)).source;
    const twice = rewriteTexTags(once, mainTags(true)).source;
    expect(twice).toBe(once);
    expect(count(twice, '\\leanok')).toBe(2);
  });

  it('is idempotent for an inside-env proof', () => {
    const once = rewriteTexTags(THEOREM_INSIDE_PROOF, mainTags(true)).source;
    const twice = rewriteTexTags(once, mainTags(true)).source;
    expect(twice).toBe(once);
    expect(count(twice, '\\leanok')).toBe(2);
  });
});

// --- write -> read round-trip fixed points ---

function writeThenReadStatus(source: string, label: string, status: string): [string, string] {
  const kind = parseBlueprintDeclarations(source).find((entry) => entry.label === label)!.kind;
  const requested = new Map([
    [label, tagsFromDeclaration({ kind, leanDeclaration: 'Demo.x', leanFile: 'Demo/X.lean', status })],
  ]);
  const { source: once, matched } = rewriteTexTags(source, requested);
  expect(matched).toEqual(new Set([label]));
  expect(rewriteTexTags(once, requested).source).toBe(once);
  const entry = parseBlueprintDeclarations(once).find((item) => item.label === label)!;
  return [declarationStatus(entry), once];
}

describe('round-trip fixed points', () => {
  it.each(['not_started', 'in_progress', 'proved'])('after-env proof round-trips %s', (status) => {
    expect(writeThenReadStatus(THEOREM_AFTER_PROOF, 'thm:main', status)[0]).toBe(status);
  });

  it.each(['not_started', 'in_progress', 'proved'])('inside-env proof round-trips %s', (status) => {
    expect(writeThenReadStatus(THEOREM_INSIDE_PROOF, 'thm:main', status)[0]).toBe(status);
  });

  it.each(['not_started', 'proved'])('definition without proof round-trips %s', (status) => {
    const source = '\\begin{definition}[Continuous]\n    \\label{def:continuous}\n    A function is continuous.\n\\end{definition}\n';
    expect(writeThenReadStatus(source, 'def:continuous', status)[0]).toBe(status);
  });

  it.each(['not_started', 'in_progress', 'proved'])('theorem without informal proof round-trips %s', (status) => {
    const source = '\\begin{theorem}[Main]\n    \\label{thm:main}\n    Statement.\n\\end{theorem}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:main', status);
    expect(parsed).toBe(status);
    if (status === 'proved') expect(rewritten).toContain('\\begin{proof}\n\\leanok\n\\end{proof}');
    else expect(rewritten).not.toContain('\\begin{proof}');
  });

  it('marks a single-line proof proved', () => {
    const source = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement.\n\\end{theorem}\n\\begin{proof} trivial \\end{proof}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'proved');
    expect(parsed).toBe('proved');
    expect(rewritten.split('\\end{theorem}')[1]).toContain('\\leanok');
  });

  it('removes a stray statement leanok on not_started and dedupes it on in_progress', () => {
    const stray = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement body.\n    \\leanok\n\\end{theorem}\n';
    const [parsed, rewritten] = writeThenReadStatus(stray, 'thm:t', 'not_started');
    expect(parsed).toBe('not_started');
    expect(rewritten).not.toContain('\\leanok');
    const withProof = stray + '\\begin{proof}\n    Proof.\n\\end{proof}\n';
    const [parsedProgress, rewrittenProgress] = writeThenReadStatus(withProof, 'thm:t', 'in_progress');
    expect(parsedProgress).toBe('in_progress');
    expect(count(rewrittenProgress, '\\leanok')).toBe(1);
  });

  it('round-trips a nested lemma proof', () => {
    const source = '\\begin{theorem}[Outer]\n    \\label{thm:outer}\n    Outer statement.\n    \\begin{lemma}[Inner]\n        \\label{lem:inner}\n        Inner statement.\n    \\end{lemma}\n    \\begin{proof}\n        Inner proof.\n    \\end{proof}\n\\end{theorem}\n';
    expect(writeThenReadStatus(source, 'lem:inner', 'proved')[0]).toBe('proved');
  });

  it('round-trips a CRLF file and keeps CRLF', () => {
    const source = '\\begin{theorem}[T]\r\n    \\label{thm:t}\r\n    Statement.\r\n\\end{theorem}\r\n\\begin{proof}\r\n    Proof.\r\n\\end{proof}\r\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'proved');
    expect(parsed).toBe('proved');
    expect(rewritten).toContain('\\leanok\r\n');
    expect(rewritten).not.toContain('\\leanok\n');
  });

  it('keeps a proof title with nested brackets', () => {
    const source = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement.\n\\end{theorem}\n\\begin{proof}[Case [0,1]]\n    Proof.\n\\end{proof}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'proved');
    expect(parsed).toBe('proved');
    expect(rewritten).toContain('\\begin{proof}[Case [0,1]]');
  });

  it('skips an inline label and leaves its proof untouched', () => {
    const source = '\\begin{theorem}[T] \\label{thm:t}\n    Statement.\n\\end{theorem}\n\\begin{proof}\n    Proof.\n\\end{proof}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'thm:t': { leanName: 'Demo.t', leanok: true, proofLeanok: true } }));
    expect(matched).toEqual(new Set());
    expect(result).toBe(source);
  });
});

const NESTED_WITH_AFTER_PROOF = '\\begin{theorem}[Outer]\n    \\label{thm:outer}\n    Outer statement.\n    \\begin{lemma}[Inner]\n        \\label{lem:inner}\n        Inner statement.\n    \\end{lemma}\n    \\begin{proof}\n        Inner proof.\n    \\end{proof}\n\\end{theorem}\n';

describe('nested ownership', () => {
  it('marks only the inner lemma proved', () => {
    const innerProved = new Map([['lem:inner', tagsFromDeclaration({ status: 'proved' })]]);
    const { source: once, matched } = rewriteTexTags(NESTED_WITH_AFTER_PROOF, innerProved);
    expect(matched).toEqual(new Set(['lem:inner']));
    expect(rewriteTexTags(once, innerProved).source).toBe(once);
    expect(statuses(once)).toEqual({ 'thm:outer': 'not_started', 'lem:inner': 'proved' });
  });

  it('keeps the inner proof leanok when the outer is unformalized', () => {
    const innerProved = new Map([['lem:inner', tagsFromDeclaration({ status: 'proved' })]]);
    const proved = rewriteTexTags(NESTED_WITH_AFTER_PROOF, innerProved).source;
    const outerUnformalized = new Map([['thm:outer', tagsFromDeclaration({ status: 'not_started' })]]);
    const { source: result, matched } = rewriteTexTags(proved, outerUnformalized);
    expect(matched).toEqual(new Set(['thm:outer']));
    expect(statuses(result)).toEqual({ 'thm:outer': 'not_started', 'lem:inner': 'proved' });
  });

  it('keeps the nested owner when the outer status is rewritten across a proof', () => {
    const source = [
      '\\begin{theorem}[Outer]\n  \\label{thm:outer}\n  \\leanok\n  Outer statement.\n\\end{theorem}\n',
      '\\begin{proof}\n  \\leanok\n  \\begin{lemma}[Inner]\n    \\label{lem:inner}\n    \\leanok\n    Inner statement.\n  \\end{lemma}\n',
      '  \\begin{proof}\n    \\leanok\n    Inner proof.\n  \\end{proof}\n\\end{proof}\n',
    ].join('');
    const requested = tags({ 'thm:outer': {} });
    const { source: result, matched } = rewriteTexTags(source, requested);
    expect(matched).toEqual(new Set(['thm:outer']));
    expect(statuses(result)).toEqual({ 'thm:outer': 'not_started', 'lem:inner': 'proved' });
    expect(rewriteTexTags(result, requested).source).toBe(result);
  });

  it('gives a nested declaration and its proof to the nested label', () => {
    const source = '\\begin{theorem}[Outer]\n  \\label{thm:outer}\n  \\begin{lemma}[Inner]\n    \\label{lem:inner}\n  \\end{lemma}\n  \\begin{proof}\n  Inner proof.\n  \\end{proof}\n\\end{theorem}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'lem:inner': { leanok: true, proofLeanok: true } }));
    expect(matched).toEqual(new Set(['lem:inner']));
    expect(count(result, '\\begin{lemma}')).toBe(1);
    expect(count(result, '\\leanok')).toBe(2);
  });
});

describe('inline and commented markers', () => {
  it('removes an inline statement leanok on not_started', () => {
    const source = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement text. \\leanok\n\\end{theorem}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'not_started');
    expect(parsed).toBe('not_started');
    expect(rewritten).not.toContain('\\leanok');
    expect(rewritten).toContain('Statement text.');
  });

  it('removes an inline proof leanok on in_progress', () => {
    const source = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement.\n\\end{theorem}\n\\begin{proof} \\leanok trivial \\end{proof}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'in_progress');
    expect(parsed).toBe('in_progress');
    expect(rewritten.split('\\end{theorem}')[1]).not.toContain('\\leanok');
  });

  it('removes a real leanok before a comment and keeps the comment', () => {
    const source = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement. \\leanok % keep this note\n\\end{theorem}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'not_started');
    expect(parsed).toBe('not_started');
    expect(rewritten).not.toContain('\\leanok');
    expect(rewritten).toContain('% keep this note');
  });

  it('leaves a commented leanok untouched', () => {
    const source = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement. % \\leanok\n\\end{theorem}\n';
    const [parsed, rewritten] = writeThenReadStatus(source, 'thm:t', 'not_started');
    expect(parsed).toBe('not_started');
    expect(rewritten).toContain('% \\leanok');
  });

  it('removes two markers on one line in one pass', () => {
    const statement = '\\begin{theorem}[T]\n    \\label{thm:t}\n    \\leanok \\leanok\n    Statement.\n\\end{theorem}\n';
    const [parsed, rewritten] = writeThenReadStatus(statement, 'thm:t', 'not_started');
    expect(parsed).toBe('not_started');
    expect(rewritten).not.toContain('\\leanok');

    const proof = '\\begin{theorem}[T]\n    \\label{thm:t}\n    Statement.\n\\end{theorem}\n\\begin{proof}\n    \\leanok \\leanok\n    Proof.\n\\end{proof}\n';
    const [parsedProof, rewrittenProof] = writeThenReadStatus(proof, 'thm:t', 'in_progress');
    expect(parsedProof).toBe('in_progress');
    expect(rewrittenProof.split('\\end{theorem}')[1]).not.toContain('\\leanok');

    const mixed = '\\begin{theorem}[T]\n    \\label{thm:t}\n    \\leanok keep prose \\leanok\n    More.\n\\end{theorem}\n';
    const [parsedMixed, rewrittenMixed] = writeThenReadStatus(mixed, 'thm:t', 'not_started');
    expect(parsedMixed).toBe('not_started');
    expect(rewrittenMixed).not.toContain('\\leanok');
    expect(rewrittenMixed).toContain('keep prose');
  });

  it('keeps prose and a commented marker while removing the real ones', () => {
    const source = '\\begin{theorem}[T]\n  \\label{thm:t}\n  \\leanok keep prose \\leanok % note \\leanok\n\\end{theorem}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'thm:t': {} }));
    expect(result).toContain('keep prose');
    expect(result).toContain('% note \\leanok');
    expect(count(result, '\\leanok')).toBe(1);
  });

  it('preserves CRLF and comments when rewriting a proof', () => {
    const source = '\\begin{theorem}[T]\r\n    \\label{thm:t}\r\n    Statement. % \\leanok\r\n\\end{theorem}\r\n\\begin{proof}\r\n    Proof.\r\n\\end{proof}\r\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'thm:t': { leanName: 'Demo.t', leanok: true, proofLeanok: true } }));
    expect(matched).toEqual(new Set(['thm:t']));
    expect(result).toContain('% \\leanok');
    expect(result).toContain('\\leanok\r\n');
    expect(result).not.toContain('\\leanok\n');
    expect(count(result, '\\leanok')).toBe(3);
  });
});

describe('edits and helpers', () => {
  it('logs and skips an overlapping edit', () => {
    expect(applyEdits('abcdef', [[1, 3, 'X'], [2, 4, 'Y']])).toBe('aXdef');
    expect(warnings.some((message) => message.toLowerCase().includes('overlapping'))).toBe(true);
  });

  it('normalizes a proof marker', () => {
    expect(rewriteProofLeanok('\\begin{proof} \\leanok x\\end{proof}', false, '\n')).toBe('\\begin{proof} x\\end{proof}');
    expect(rewriteProofLeanok('\\begin{proof}[Case [0,1]] trivial \\end{proof}', true, '\n')).toBe(
      '\\begin{proof}[Case [0,1]]\n\\leanok\ntrivial \\end{proof}',
    );
  });

  it('detects markers inside comments', () => {
    expect(isInComment('  \\% escaped % comment \\leanok', 26)).toBe(true);
    expect(isInComment('  \\% escaped \\leanok', 20)).toBe(false);
  });

  it('is a no-op on broken or unrelated sources', () => {
    const broken = '\\begin{theorem}[broken]\n  \\label{x}\n';
    expect(rewriteTexTags(broken, tags({ x: {} }))).toEqual({ source: broken, matched: new Set() });
    const complete = '\\begin{lemma}\nbody\n\\end{lemma}\n';
    expect(rewriteTexTags(complete, tags({ other: {} }))).toEqual({ source: complete, matched: new Set() });
    expect(rewriteTexTags(complete, new Map())).toEqual({ source: complete, matched: new Set() });
    const inline = '\\begin{theorem}[T] \\label{thm:t}\n\\end{theorem}\n';
    expect(rewriteTexTags(inline, tags({ 'thm:t': { leanok: true }, ghost: {} }))).toEqual({ source: inline, matched: new Set() });
  });

  it('marks an inside-env proof', () => {
    const source = '\\begin{lemma}\n  \\label{x}\n  \\begin{proof}\n  p\n  \\end{proof}\n\\end{lemma}\n';
    expect(rewriteTexTags(source, tags({ x: { proofLeanok: true } })).source).toContain('\\begin{proof}\n  \\leanok\n');
  });

  it('keeps proof titles and single-line proofs idempotent', () => {
    const source = '\\begin{theorem}[T]\n  \\label{thm:t}\n\\end{theorem}\n\\begin{proof}[Case [0,1]] trivial \\end{proof}\n';
    const requested = tags({ 'thm:t': { leanok: true, proofLeanok: true } });
    const once = rewriteTexTags(source, requested).source;
    expect(rewriteTexTags(once, requested).source).toBe(once);
    expect(once).toContain('\\begin{proof}[Case [0,1]]\n\\leanok\ntrivial');
  });

  it('creates a missing proof and replaces the tag block', () => {
    const source = '\\begin{theorem}[T]\n  \\label{thm:t}\n  \\lean{Old}\n\\end{theorem}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'thm:t': { leanName: 'New', leanok: true, proofLeanok: true, createMissingProof: true } }));
    expect(result).not.toContain('\\lean{Old}');
    expect(result).toContain('\\lean{New}');
    expect(result).toContain('\\begin{proof}\n\\leanok\n\\end{proof}');
  });

  it('indents a created stub like its declaration', () => {
    const source = '  \\begin{theorem}[T]\n    \\label{thm:t}\n    S.\n  \\end{theorem}\n';
    const { source: result } = rewriteTexTags(source, tags({ 'thm:t': { leanok: true, proofLeanok: true, createMissingProof: true } }));
    expect(result).toContain('  \\end{theorem}\n  \\begin{proof}\n  \\leanok\n  \\end{proof}\n');
  });
});

describe('\\proves-linked proofs', () => {
  it('marks a linked proof in the same file instead of creating a stub', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    Statement of the lemma.\n\\end{lemma}\n\nProse in between.\n\n\\begin{proof}\n    \\proves{lem:helper}\n    The detached proof.\n\\end{proof}\n';
    const requested = tags({ 'lem:helper': { leanName: 'Demo.helper', leanok: true, proofLeanok: true, createMissingProof: true } });
    const { source: result, matched } = rewriteTexTags(source, requested);
    expect(matched).toEqual(new Set(['lem:helper']));
    expect(result).toBe(
      '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    \\lean{Demo.helper}\n    \\leanok\n    Statement of the lemma.\n\\end{lemma}\n\nProse in between.\n\n\\begin{proof}\n    \\leanok\n    \\proves{lem:helper}\n    The detached proof.\n\\end{proof}\n',
    );
    expect(count(result, '\\begin{proof}')).toBe(1);
    expect(declarationStatus(parseBlueprintDeclarations(result)[0])).toBe('proved');
    expect(rewriteTexTags(result, requested).source).toBe(result);
  });

  it('leaves an adjacent proof that proves another label alone', () => {
    const source = '\\begin{lemma}[A]\n    \\label{lem:a}\n    Statement A.\n\\end{lemma}\n\\begin{proof}\n    \\leanok\n    \\proves{lem:b}\n    Proof of B.\n\\end{proof}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'lem:a': { leanok: true, proofLeanok: false } }));
    expect(matched).toEqual(new Set(['lem:a']));
    expect(result).toContain('\\leanok\n    \\proves{lem:b}');
  });

  it('does not create a stub when the proof lives in another file', () => {
    const source = '\\begin{lemma}[Helper]\n    \\label{lem:helper}\n    Statement of the lemma.\n\\end{lemma}\n';
    const { source: result, matched } = rewriteTexTags(source, tags({ 'lem:helper': { leanok: true, proofLeanok: true, createMissingProof: true, proofInOtherFile: true } }));
    expect(matched).toEqual(new Set(['lem:helper']));
    expect(result).not.toContain('\\begin{proof}');
    const viaMetadata = tagsFromDeclaration({ kind: 'theorem', status: 'proved', sourceFile: 'blueprint/src/content.tex', proofSourceFile: 'blueprint/src/proofs.tex' });
    const theorem = '\\begin{theorem}\n  \\label{thm:t}\nStatement.\n\\end{theorem}\n';
    const outcome = rewriteTexTags(theorem, new Map([['thm:t', viaMetadata]]));
    expect(outcome.matched).toEqual(new Set(['thm:t']));
    expect(outcome.source).toContain('\\leanok');
    expect(outcome.source).not.toContain('\\begin{proof}');
  });

  it('marks a cross-file proof with rewriteProofLeanokTags', () => {
    const source = '\\section{Appendix}\n\\begin{proof}[Proof of Lemma~\\ref{lem:helper}]\n    \\proves{lem:helper}\n    The proof, in another chapter.\n\\end{proof}\n';
    const { source: marked, matched } = rewriteProofLeanokTags(source, new Map([['lem:helper', true]]));
    expect(matched).toEqual(new Set(['lem:helper']));
    expect(marked).toBe('\\section{Appendix}\n\\begin{proof}[Proof of Lemma~\\ref{lem:helper}]\n    \\leanok\n    \\proves{lem:helper}\n    The proof, in another chapter.\n\\end{proof}\n');
    expect(rewriteProofLeanokTags(marked, new Map([['lem:helper', true]])).source).toBe(marked);
    expect(rewriteProofLeanokTags(marked, new Map([['lem:helper', false]])).source).toBe(source);
  });

  it('reports a missing proves block as unmatched', () => {
    const source = '\\begin{proof}\n    Some unrelated adjacent proof.\n\\end{proof}\n';
    expect(rewriteProofLeanokTags(source, new Map([['lem:helper', true]]))).toEqual({ source, matched: new Set() });
  });

  it('rewrites a linked proof nested inside another linked proof', () => {
    const source = '\\begin{proof}\n  \\proves{thm:outer}\n  Outer.\n  \\begin{proof}\n    \\proves{lem:inner}\n    \\leanok\n    Inner.\n  \\end{proof}\n\\end{proof}\n';
    const requested = new Map([['thm:outer', true], ['lem:inner', false]]);
    const { source: result, matched } = rewriteProofLeanokTags(source, requested);
    expect(matched).toEqual(new Set(['thm:outer', 'lem:inner']));
    expect(result).toBe('\\begin{proof}\n  \\leanok\n  \\proves{thm:outer}\n  Outer.\n  \\begin{proof}\n    \\proves{lem:inner}\n    Inner.\n  \\end{proof}\n\\end{proof}\n');
    expect(rewriteProofLeanokTags(result, requested).source).toBe(result);
  });
});
