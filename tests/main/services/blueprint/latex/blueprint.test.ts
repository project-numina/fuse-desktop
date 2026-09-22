import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DECLARATION_KINDS,
  declarationRequiresProof,
  declarationStatus,
  deriveLeanokStatus,
  formalizationIsTerminal,
  isPythonSpace,
  nestedDeclarationSpans,
  parseBlueprintDeclarations,
  parseBlueprintLatex,
  type BlueprintDeclaration,
} from '@main/services/blueprint/latex/blueprint';
import { setLatexWarningSink } from '@main/services/blueprint/latex/log';

let warnings: string[];

beforeEach(() => {
  warnings = [];
  setLatexWarningSink((message) => warnings.push(message));
});

afterEach(() => {
  setLatexWarningSink(null);
});

/** Parse exactly one declaration. */
function one(source: string): BlueprintDeclaration {
  const declarations = parseBlueprintDeclarations(source);
  expect(declarations).toHaveLength(1);
  return declarations[0];
}

function byLabel(source: string): Record<string, BlueprintDeclaration> {
  return Object.fromEntries(parseBlueprintDeclarations(source).map((declaration) => [declaration.label, declaration]));
}

describe('basic fields', () => {
  it('parses statement, proof and lean metadata', () => {
    const declaration = one(`
\\begin{lemma}[Bound]
\\label{lem:bound}
\\lean{MyProject.bound}
\\leanfile{MyProject/Bound.lean}
\\uses{def:continuous, thm:froda}
Every bounded sequence has a convergent subsequence.
\\end{lemma}
\\begin{proof}
\\uses{thm:froda}
Apply compactness.
\\end{proof}
`);
    expect(declaration.kind).toBe('lemma');
    expect(declaration.label).toBe('lem:bound');
    expect(declaration.title).toBe('Bound');
    expect(declaration.statement).toBe('Every bounded sequence has a convergent subsequence.');
    expect(declaration.proof).toBe('Apply compactness.');
    expect(declaration.leanName).toBe('MyProject.bound');
    expect(declaration.leanFile).toBe('MyProject/Bound.lean');
    expect(declaration.uses).toEqual(['def:continuous', 'thm:froda']);
  });

  it('attaches a proof inside the declaration', () => {
    const declaration = one(`
\\begin{theorem}[Inner]
\\label{thm:inner}
Statement.
\\begin{proof}
Proof inside.
\\end{proof}
\\end{theorem}
`);
    expect(declaration.statement).toBe('Statement.');
    expect(declaration.proof).toBe('Proof inside.');
  });

  it('parses nested same-kind declarations', () => {
    const declarations = byLabel(`
\\begin{theorem}[Outer]
\\label{thm:outer}
Outer opening.
\\begin{theorem}[Inner]
\\label{thm:inner}
Inner statement.
\\end{theorem}
Outer closing.
\\end{theorem}
`);
    expect(Object.keys(declarations).sort()).toEqual(['thm:inner', 'thm:outer']);
    expect(declarations['thm:outer'].statement).toContain('Outer opening');
    expect(declarations['thm:outer'].statement).toContain('Outer closing');
    expect(declarations['thm:outer'].statement).not.toContain('Inner statement');
    expect(declarations['thm:inner'].statement).toBe('Inner statement.');
  });

  it('keeps nested metadata with its owner', () => {
    const [outer, inner] = parseBlueprintDeclarations(`
\\begin{theorem}[Outer]
\\label{thm:outer}
\\uses{def:outer}
\\lean{Outer.result}
Outer statement.
\\begin{lemma}[Inner]
\\label{lem:inner}
\\uses{def:inner}
\\lean{Inner.result}
Inner statement.
\\end{lemma}
\\end{theorem}
`);
    expect(outer.uses).toEqual(['def:outer']);
    expect(outer.leanName).toBe('Outer.result');
    expect(inner.uses).toEqual(['def:inner']);
    expect(inner.leanName).toBe('Inner.result');
  });

  it('strips repeated identical nested declarations by span', () => {
    const nested = `
\\begin{lemma}[Repeated]
\\label{lem:repeated}
\\uses{def:inner}
\\lean{Inner.repeated}
Inner statement.
\\end{lemma}
`;
    const source = `
\\begin{theorem}[Outer]
\\label{thm:outer}
Outer opening.
${nested}
Middle text.
${nested}
\\uses{def:outer}
\\lean{Outer.repeated}
Outer closing.
\\end{theorem}
`;
    const declarations = parseBlueprintDeclarations(source);
    const outer = declarations.find((item) => item.label === 'thm:outer')!;
    expect(outer.uses).toEqual(['def:outer']);
    expect(outer.leanName).toBe('Outer.repeated');
    expect(outer.statement).not.toContain('Inner statement');
    expect(outer.statement).toContain('Middle text');
    expect(outer.statement).toContain('Outer closing');
    expect(declarations.filter((item) => item.label === 'lem:repeated')).toHaveLength(2);
  });

  it('gives a nested trailing proof only to the inner declaration', () => {
    const [outer, inner] = parseBlueprintDeclarations(`
\\begin{theorem}[Outer]
\\label{thm:outer}
Outer statement.
\\begin{lemma}[Inner]
\\label{lem:inner}
\\leanok
Inner statement.
\\end{lemma}
\\begin{proof}
\\leanok
Inner proof.
\\end{proof}
\\end{theorem}
`);
    expect(outer.proof).toBeNull();
    expect(declarationStatus(outer)).toBe('not_started');
    expect(inner.proof).toBe('Inner proof.');
    expect(inner.proofLeanok).toBe(true);
    expect(declarationStatus(inner)).toBe('proved');
  });

  it('does not let an unlabeled outer hide a labeled inner or sibling', () => {
    const labels = parseBlueprintDeclarations(`
\\begin{theorem}[Unlabeled outer]
\\begin{theorem}[Inner]
\\label{thm:inner}
Inner statement.
\\end{theorem}
\\end{theorem}
\\begin{lemma}[Sibling]
\\label{lem:sibling}
Sibling statement.
\\end{lemma}
`).map((declaration) => declaration.label);
    expect(labels).toEqual(['thm:inner', 'lem:sibling']);
  });

  it('skips a blank label instead of aborting', () => {
    const labels = parseBlueprintDeclarations(`
\\begin{lemma}\\label{ }Blank.\\end{lemma}
\\begin{lemma}\\label{lem:ok}Fine.\\end{lemma}
`).map((declaration) => declaration.label);
    expect(labels).toEqual(['lem:ok']);
  });
});

describe('titles', () => {
  it.each([
    ['\\begin{theorem}[Dirichlet eigenvalues on $[0,\\pi]$]\n\\label{thm:dirichlet}\nStatement.\n\\end{theorem}\n', 'Dirichlet eigenvalues on $[0,\\pi]$'],
    ['\\begin{lemma}[Convergence on $[0,\\infty)$]\n\\label{lem:half-open-math}\nStatement.\n\\end{lemma}\n', 'Convergence on $[0,\\infty)$'],
    ['\\begin{lemma}[Convergence on [0,\\infty) intervals]\n\\label{lem:half-open-text}\nStatement.\n\\end{lemma}\n', 'Convergence on [0,\\infty) intervals'],
    ['\\begin{definition}[Interval [a,b] notation]\n\\label{def:interval}\nStatement.\n\\end{definition}\n', 'Interval [a,b] notation'],
  ])('handles bracket edge cases', (source, expected) => {
    expect(one('\n' + source).title).toBe(expected);
  });

  it('defaults a missing or unterminated title to the label', () => {
    expect(one('\n\\begin{lemma}\n\\label{lem:no-title}\nStatement.\n\\end{lemma}\n').title).toBe('lem:no-title');
    expect(one('\n\\begin{lemma}[Broken title\n\\label{lem:broken-title}\nStatement.\n\\end{lemma}\n').title).toBe('lem:broken-title');
  });

  it('keeps math brackets inside a title and finds the following metadata', () => {
    const declaration = one(`
\\begin{theorem}[Dirichlet eigenvalues of $-y'' = \\lambda y$ on $[0,\\pi]$]
    \\label{thm:dirichlet_eigenvalues_eq_nat_sq}
    \\uses{lem:sin_eigenfunction}
    A real $\\lambda$ admits a nontrivial twice-differentiable Dirichlet
    eigenfunction on $[0,\\pi]$ if and only if $\\lambda = n^2$ for some
    positive natural number $n$.
\\end{theorem}
\\begin{proof}
    \\uses{lem:sin_eigenfunction}
    The backward implication is \\cref{lem:sin_eigenfunction}.
\\end{proof}
`);
    expect(declaration.title).toBe("Dirichlet eigenvalues of $-y'' = \\lambda y$ on $[0,\\pi]$");
    expect(declaration.label).toBe('thm:dirichlet_eigenvalues_eq_nat_sq');
    expect(declaration.statement.startsWith('A real')).toBe(true);
    expect(declaration.uses).toEqual(['lem:sin_eigenfunction']);
    expect(declaration.proof).not.toBeNull();
  });

  it('falls back to the label for an empty title', () => {
    expect(one('\\begin{lemma}[]\\label{lem:empty}S.\\end{lemma}').title).toBe('lem:empty');
  });
});

describe('whitespace (Python str.isspace parity)', () => {
  // `str.isspace()` over the whole code space, as enumerated by CPython.
  const PYTHON_SPACES = new Set([
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  ]);

  it('isPythonSpace agrees with str.isspace on every BMP character', () => {
    const wrong: string[] = [];
    for (let code = 0; code < 0x10000; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      if (isPythonSpace(String.fromCharCode(code)) !== PYTHON_SPACES.has(code)) wrong.push(`U+${code.toString(16)}`);
    }
    expect(wrong).toEqual([]);
    // The two places JS `\s` disagrees with Python: C1 separators / NEL are
    // whitespace there, the BOM is not.
    expect(isPythonSpace('\x85')).toBe(true);
    expect(isPythonSpace('\x1c')).toBe(true);
    expect(isPythonSpace('\uFEFF')).toBe(false);
  });

  it.each([
    ['NEL', '\x85', 'P.', 'proved'],
    ['file separator', '\x1c', 'P.', 'proved'],
    ['newline', '\n', 'P.', 'proved'],
    ['BOM', '\uFEFF', null, 'not_started'],
  ])('attributes an adjacent proof across %s exactly as the Python parser', (_name, separator, proof, status) => {
    const source = `\\begin{theorem}\n\\label{thm:a}\nS.\n\\end{theorem}\n${separator}\\begin{proof}\n\\leanok\nP.\n\\end{proof}\n`;
    const [declaration] = parseBlueprintLatex(source).declarations;
    expect(declaration.proof).toBe(proof);
    expect(declarationStatus(declaration)).toBe(status);
  });

  it('skips Python whitespace (not the BOM) before an optional title', () => {
    expect(one('\\begin{lemma}\x85[Titled]\\label{lem:nel}S.\\end{lemma}').title).toBe('Titled');
    expect(one('\\begin{lemma}\uFEFF[Titled]\\label{lem:bom}S.\\end{lemma}').title).toBe('lem:bom');
  });
});

describe('comments and leanok', () => {
  it('ignores a commented leanok', () => {
    const declaration = one(`
\\begin{theorem}[Pending]
\\label{thm:pending}
% \\leanok
Statement with an escaped percent \\% sign.
\\end{theorem}
`);
    expect(declaration.statementLeanok).toBe(false);
    expect(declarationStatus(declaration)).toBe('not_started');
  });

  it('does not let a percent-encoded url hide following metadata', () => {
    expect(one('\n\\begin{theorem}[URL]\n\\url{https://example.com/a%20b} \\label{thm:url}\nStatement.\n\\end{theorem}\n').label).toBe('thm:url');
  });

  it('treats a leanok lookalike as ordinary text', () => {
    const declaration = one('\n\\begin{theorem}[Lookalike]\n\\label{thm:lookalike}\n\\leanoknot something\n\\end{theorem}\n');
    expect(declaration.statementLeanok).toBe(false);
    expect(declaration.statement).toBe('\\leanoknot something');
  });

  it('removes leanok from the statement and the inside proof', () => {
    const declaration = one(`
\\begin{theorem}[Done]
\\label{thm:done}
\\leanok
Statement.
\\begin{proof}
\\leanok
Proof inside.
\\end{proof}
\\end{theorem}
`);
    expect(declaration.statement).toBe('Statement.');
    expect(declaration.proof).toBe('Proof inside.');
    expect(declaration.statementLeanok).toBe(true);
    expect(declaration.proofLeanok).toBe(true);
    expect(declarationStatus(declaration)).toBe('proved');
  });

  it.each([
    ['\\begin{theorem}\\label{thm:bare}Statement.\\end{theorem}\n', 'not_started'],
    ['\\begin{theorem}\\label{thm:statement}\\leanok Statement.\\end{theorem}\n', 'in_progress'],
    ['\\begin{definition}\\label{def:done}\\leanok Definition.\\end{definition}\n', 'proved'],
    ['\\begin{theorem}\\label{thm:proof}\\leanok Statement.\\end{theorem}\n\\begin{proof}\\leanok Proof.\\end{proof}\n', 'proved'],
    ['\\begin{theorem}\\label{thm:proof-pending}\\leanok Statement.\\end{theorem}\n\\begin{proof}Proof.\\end{proof}\n', 'in_progress'],
  ])('derives a kind and proof aware status', (source, expected) => {
    expect(declarationStatus(one('\n' + source))).toBe(expected);
  });

  it.each([
    ['theorem', true],
    ['LEMMA', true],
    ['claim', true],
    ['definition', false],
    ['axiom', false],
    ['notation', false],
    ['unknown', false],
  ])('declarationRequiresProof(%s)', (kind, required) => {
    expect(declarationRequiresProof(kind)).toBe(required);
  });

  it('exposes the status helpers', () => {
    expect(formalizationIsTerminal('definition', false)).toBe(true);
    expect(formalizationIsTerminal('theorem', false)).toBe(false);
    expect(formalizationIsTerminal('definition', true)).toBe(false);
    expect(deriveLeanokStatus('lemma', false, true, false)).toBe('in_progress');
    expect(deriveLeanokStatus('definition', false, true, false)).toBe('proved');
    expect(deriveLeanokStatus('lemma', true, false, true)).toBe('proved');
    expect(deriveLeanokStatus('lemma', true, false, false)).toBe('not_started');
  });

  it('removes ready markers from statements', () => {
    const [first, second] = parseBlueprintDeclarations(`
\\begin{definition}\\label{def:notready}\\notready Not ready.\\end{definition}
\\begin{definition}\\label{def:ready}\\ready Ready.\\end{definition}
`);
    expect(first.statement).toBe('Not ready.');
    expect(second.statement).toBe('Ready.');
    const presheaf = one('\n\\begin{definition}[Presheaf]\n\\label{def:presheaf}\n\\lean{Presheaf}\n\\notready\nLet $X$ be a topological space.\n\\end{definition}\n');
    expect(presheaf.statement.startsWith('Let $X$')).toBe(true);
  });

  it.each(['\\uses{def:foo}\\lean{MyProject.delayed}', '% an ordinary LaTeX comment'])(
    'lets the label follow metadata or a comment',
    (prefix) => {
      const declaration = one(`
\\begin{theorem}[Delayed label]
${prefix}
\\label{thm:delayed}
Statement.
\\end{theorem}
`);
      expect(declaration.label).toBe('thm:delayed');
      if (prefix.startsWith('\\uses')) {
        expect(declaration.uses).toEqual(['def:foo']);
        expect(declaration.leanName).toBe('MyProject.delayed');
      }
    },
  );

  it('does not parse a fully commented declaration', () => {
    expect(parseBlueprintDeclarations('\n% \\begin{theorem}[Ghost]\n% \\label{thm:ghost}\n% This theorem is entirely commented out.\n% \\end{theorem}\n')).toEqual([]);
  });

  it('keeps commented structure from interfering with the real declaration', () => {
    const declaration = one(`
% \\begin{theorem}[Ghost without a matching end]
\\begin{theorem}[Visible]% \\end{theorem}
% \\label{thm:ghost}
\\label{thm:visible}% \\begin{lemma}[Ghost nested]
% \\lean{Ghost.result}
\\lean{Visible.result}% \\leanfile{Ghost.lean}
\\uses{def:real}% \\uses{def:ghost}
A 50\\% result.% \\begin{proof}
\\end{theorem}% \\begin{theorem}[Ghost sibling]
\\begin{proof}% \\end{proof}
Proof with 100\\% coverage.% \\end{theorem}
\\end{proof}
`);
    expect(declaration.label).toBe('thm:visible');
    expect(declaration.leanName).toBe('Visible.result');
    expect(declaration.leanFile).toBe('');
    expect(declaration.uses).toEqual(['def:real']);
    expect(declaration.statement).toContain('50\\% result.');
    expect(declaration.proof).not.toBeNull();
    expect(declaration.proof).toContain('100\\% coverage.');
  });

  it('gives commented nested children no ownership', () => {
    const declaration = one(`
\\begin{theorem}[Outer]
\\label{thm:outer}
Outer statement.
% \\begin{lemma}[Ghost]
% \\label{lem:ghost}
% Ghost statement.
% \\end{lemma}
% \\begin{proof}
% Ghost proof.
% \\end{proof}
Outer continuation.
\\end{theorem}
`);
    expect(declaration.label).toBe('thm:outer');
    expect(declaration.proof).toBeNull();
    expect(declaration.statement).toContain('Outer statement');
    expect(declaration.statement).toContain('Outer continuation');
  });

  it('keeps an escaped percent as text', () => {
    const declaration = one('\n\\begin{theorem}\nAt most 5\\% of points. \\label{thm:percent}\n\\end{theorem}\n');
    expect(declaration.label).toBe('thm:percent');
    expect(declaration.statement).toBe('At most 5\\% of points.');
  });

  it('ignores commented end, label and uses', () => {
    expect(parseBlueprintDeclarations('\n\\begin{theorem}\n\\label{thm:unterminated}\nA statement.\n% \\end{theorem}\n')).toEqual([]);
    expect(parseBlueprintDeclarations('\n\\begin{theorem}\n% \\label{thm:commented}\n\\label{thm:real}\nA statement.\n\\end{theorem}\n').map((d) => d.label)).toEqual(['thm:real']);
    expect(one('\n\\begin{theorem}\n\\label{thm:t}\n% \\uses{def:commented}\n\\uses{def:real}\nA statement.\n\\end{theorem}\n').uses).toEqual(['def:real']);
  });

  it('leaves a commented-out neighbour and nested declaration as prose', () => {
    const entries = parseBlueprintDeclarations('\n% \\begin{lemma}\n% \\label{lem:retired}\n% Retired.\n% \\end{lemma}\n\n\\begin{lemma}\n\\label{lem:live}\nLive.\n\\end{lemma}\n');
    expect(entries.map((entry) => entry.label)).toEqual(['lem:live']);
    expect(entries[0].statement).toBe('Live.');
    const outer = one('\n\\begin{theorem}\n\\label{thm:outer}\nConsider this:\n% \\begin{lemma}\n% \\label{lem:inner}\n% Inner.\n% \\end{lemma}\nOuter continues.\n\\end{theorem}\n');
    expect(outer.statement).toContain('Outer continues.');
  });
});

describe('uses accumulation', () => {
  it('takes statement uses as dependencies and strips proof uses', () => {
    const declaration = one('\n\\begin{theorem}[Uses]\n\\label{thm:uses}\n\\uses{def:a, def:b}\nStatement.\n\\end{theorem}\n\\begin{proof}\n\\uses{lem:c}\nUse lemma c.\n\\end{proof}\n');
    expect(declaration.uses).toEqual(['def:a', 'def:b']);
    expect(declaration.statement).toBe('Statement.');
    expect(declaration.proof).toBe('Use lemma c.');
  });

  it('accumulates repeated statement uses blocks', () => {
    const declaration = one('\n\\begin{theorem}[Accumulated]\n\\label{thm:accumulated}\n\\uses{def:a, def:b}\nStatement.\n\\uses{def:c}\nMore statement.\n\\end{theorem}\n');
    expect(declaration.uses).toEqual(['def:a', 'def:b', 'def:c']);
    expect(declaration.statement).toBe('Statement.\nMore statement.');
  });

  it('collapses duplicate labels across uses blocks', () => {
    expect(one('\n\\begin{theorem}[Duplicated]\n\\label{thm:duplicated}\n\\uses{def:a, def:b}\n\\uses{def:b, def:a}\nStatement.\n\\end{theorem}\n').uses).toEqual(['def:a', 'def:b']);
  });

  it('does not accumulate uses from a nested proof', () => {
    const declaration = one('\n\\begin{theorem}[Inner proof]\n\\label{thm:inner-proof}\n\\uses{def:a}\nStatement.\n\\begin{proof}\n\\uses{lem:presentation}\nProof inside.\n\\end{proof}\n\\end{theorem}\n');
    expect(declaration.uses).toEqual(['def:a']);
    expect(declaration.proof).toBe('Proof inside.');
  });

  it('still accumulates uses written after a nested proof', () => {
    expect(one('\n\\begin{theorem}[Straddling]\n\\label{thm:straddling}\n\\uses{def:before}\nStatement.\n\\begin{proof}\n\\uses{lem:presentation}\nProof inside.\n\\end{proof}\n\\uses{def:after}\nTrailing statement.\n\\end{theorem}\n').uses).toEqual(['def:before', 'def:after']);
  });

  it('cuts a proof containing a proof whole', () => {
    const declaration = one(`
\\begin{theorem}[Claim inside]
\\label{thm:claim-inside}
\\uses{def:before}
Statement.
\\begin{proof}
The claim below does the work.
\\begin{proof}[Proof of the claim]
Inner reasoning.
\\end{proof}
\\uses{lem:presentation}
Back in the outer proof.
\\end{proof}
\\end{theorem}
`);
    expect(declaration.uses).toEqual(['def:before']);
    expect(declaration.statement).toBe('Statement.');
    expect(declaration.proof).not.toBeNull();
    expect(declaration.statement).not.toContain('\\uses{lem:presentation}');
  });

  it('extends a nested declaration span through a proof containing a proof', () => {
    const declarations = parseBlueprintDeclarations(`
\\begin{theorem}
\\label{thm:outer}
Outer statement.
\\begin{lemma}
\\label{lem:inner}
Inner statement.
\\end{lemma}
\\begin{proof}
Inner proof.
\\begin{proof}[Proof of a sub-claim]
Deeper still.
\\end{proof}
\\uses{lem:presentation}
\\end{proof}
\\end{theorem}
`);
    const outer = declarations.find((item) => item.label === 'thm:outer')!;
    expect(outer.uses).toEqual([]);
    expect(outer.statement).toBe('Outer statement.');
  });

  it('ignores a commented uses block', () => {
    expect(one('\n\\begin{theorem}[Commented]\n\\label{thm:commented}\n\\uses{def:a}\n% \\uses{def:dropped}\nStatement.\n\\end{theorem}\n').uses).toEqual(['def:a']);
  });

  it('drops empty and blank uses entries', () => {
    expect(one('\n\\begin{theorem}[Blanks]\n\\label{thm:blanks}\n\\uses{}\n\\uses{def:a, , def:b}\nStatement.\n\\end{theorem}\n').uses).toEqual(['def:a', 'def:b']);
  });

  it('discards uses in a proves-linked proof', () => {
    const declarations = parseBlueprintDeclarations('\n\\begin{theorem}[Linked]\n\\label{thm:linked}\n\\uses{def:a}\nStatement.\n\\end{theorem}\n\\begin{proof}\n\\proves{thm:linked}\n\\uses{lem:presentation}\nProof elsewhere.\n\\end{proof}\n');
    expect(declarations).toHaveLength(1);
    expect(declarations[0].uses).toEqual(['def:a']);
    expect(declarations[0].proof).toBe('Proof elsewhere.');
  });
});

describe('kinds and malformed input', () => {
  it('parses every supported kind in order', () => {
    const source = DECLARATION_KINDS.map((kind) => `\\begin{${kind}}\\label{${kind}:one}Body.\\end{${kind}}`).join('\n');
    expect(parseBlueprintDeclarations(source).map((item) => item.kind)).toEqual([...DECLARATION_KINDS]);
  });

  it('skips unclosed and unlabeled declarations', () => {
    const labels = parseBlueprintDeclarations('\n\\begin{theorem}[No label]\nSkipped.\n\\end{theorem}\n\\begin{lemma}[Good]\n\\label{lem:good}\nParsed.\n\\end{lemma}\n\\begin{theorem}[Unclosed]\n\\label{thm:unclosed}\nBroken.\n').map((item) => item.label);
    expect(labels).toEqual(['lem:good']);
  });

  it('parses an empty source', () => {
    expect(parseBlueprintDeclarations('')).toEqual([]);
    expect(parseBlueprintLatex('')).toEqual({ declarations: [], unattachedProofs: [] });
  });

  it('parses the real two-result blueprint fixture', () => {
    const declarations = parseBlueprintDeclarations(`
\\begin{lemma}[Independent vectors determine the same scalar]
    \\label{lem:independent-vectors-determine-the-same-scalar}
    Let $E$ be a vector space over a field $K$, and let $f : E \\to E$ be a
    linear map. Assume that for every $x \\in E$ there exists $\\lambda_x \\in K$
    such that $f(x) = \\lambda_x x$. If $u, v \\in E$ are linearly independent,
    then there exists $\\lambda \\in K$ such that $f(u) = \\lambda u$ and
    $f(v) = \\lambda v$.
\\end{lemma}
\\begin{proof}
    Choose $\\lambda_u, \\lambda_v \\in K$ such that $f(u) = \\lambda_u u$ and
    $f(v) = \\lambda_v v$. Apply the hypothesis to $u + v$ and choose
    $\\mu \\in K$ such that $f(u + v) = \\mu (u + v)$. By linearity,
    \\[
        \\mu u + \\mu v = f(u + v) = f(u) + f(v)
        = \\lambda_u u + \\lambda_v v.
    \\]
    Hence
    \\[
        (\\mu - \\lambda_u) u + (\\mu - \\lambda_v) v = 0.
    \\]
    Since $u$ and $v$ are linearly independent, both coefficients vanish, so
    $\\mu = \\lambda_u = \\lambda_v$.
\\end{proof}

\\begin{theorem}[A pointwise scalar linear map is a scalar multiple of the identity]
    \\label{thm:pointwise-scalar-linear-map-is-a-scalar-multiple-of-the-identity}
    \\uses{lem:independent-vectors-determine-the-same-scalar}
    Let $E$ be a vector space over a field $K$, and let $f : E \\to E$ be a
    linear map such that for every $x \\in E$ there exists $\\lambda_x \\in K$
    with $f(x) = \\lambda_x x$. Then there exists $\\lambda \\in K$ such that for
    every $x \\in E$, $f(x) = \\lambda x$. Equivalently, there exists
    $\\lambda \\in K$ such that $f = \\lambda \\operatorname{Id}_E$.
\\end{theorem}
\\begin{proof}
    \\uses{lem:independent-vectors-determine-the-same-scalar}
    If $E = \\{0\\}$, take $\\lambda = 0$. Assume now that $E \\neq \\{0\\}$ and
    choose $u \\in E$ with $u \\neq 0$. Choose $\\lambda \\in K$ such that
    $f(u) = \\lambda u$. Let $y \\in E$. If $y$ is a scalar multiple of $u$,
    then linearity gives $f(y) = \\lambda y$. If $y$ is not a scalar multiple
    of $u$, then $u$ and $y$ are linearly independent, so the lemma shows that
    the scalar attached to $y$ is also $\\lambda$. Therefore
    $f(y) = \\lambda y$ for every $y \\in E$, and thus
    $f = \\lambda \\operatorname{Id}_E$.
\\end{proof}
`);
    expect(declarations.map((item) => item.label)).toEqual([
      'lem:independent-vectors-determine-the-same-scalar',
      'thm:pointwise-scalar-linear-map-is-a-scalar-multiple-of-the-identity',
    ]);
    expect(declarations[1].uses).toEqual(['lem:independent-vectors-determine-the-same-scalar']);
    expect(declarations[0].proof).not.toBeNull();
    expect(declarations[1].proof).not.toBeNull();
    expect(declarations[0].statement).toContain('linearly independent');
    expect(declarations[1].proof).not.toContain('\\uses');
  });

  it('parses several kinds with metadata', () => {
    const entries = parseBlueprintDeclarations('\n\\begin{conjecture}[Goldbach]\n\\label{conj:goldbach}\n\\uses{def:prime}\nEvery even integer greater than two is a sum of two primes.\n\\end{conjecture}\n\n\\begin{example}[Small case]\n\\label{ex:small}\n\\uses{conj:goldbach}\n$4 = 2 + 2$.\n\\end{example}\n');
    expect(entries.map((entry) => entry.kind)).toEqual(['conjecture', 'example']);
    expect(entries.map((entry) => entry.label)).toEqual(['conj:goldbach', 'ex:small']);
    expect(entries[0].uses).toEqual(['def:prime']);
    expect(entries[1].uses).toEqual(['conj:goldbach']);
    const axiom = one('\n\\begin{axiom}[Choice]\n\\label{axm:choice}\n\\uses{def:set, def:family}\nEvery family of nonempty sets admits a choice function.\n\\end{axiom}\n');
    expect(axiom.kind).toBe('axiom');
    expect(axiom.uses).toEqual(['def:set', 'def:family']);
  });

  it('records the source line', () => {
    const [declaration] = parseBlueprintDeclarations('% heading\n\n\\begin{lemma}\\label{lem:located}Statement.\\end{lemma}\n');
    expect(declaration.sourceLine).toBe(3);
  });

  it('returns no nested spans for a malformed body', () => {
    const malformed = '\\begin{lemma}\n';
    expect(nestedDeclarationSpans(malformed, malformed, 0, malformed.length)).toEqual([]);
  });
});

describe('\\proves', () => {
  it('attaches a detached proof', () => {
    const declaration = one(`
\\begin{theorem}[Foo]
\\label{thm:foo}
The statement of foo.
\\end{theorem}

Prose, a figure, and unrelated discussion.

\\begin{proof}[Proof of Theorem~\\ref{thm:foo}]
\\proves{thm:foo}
\\leanok
The detached proof.
\\end{proof}
`);
    expect(declaration.proof).toBe('The detached proof.');
    expect(declarationStatus(declaration)).toBe('proved');
  });

  it('keeps a neighbour from claiming a proves-tagged proof', () => {
    const declarations = parseBlueprintDeclarations('\n\\begin{lemma}[A]\n\\label{lem:a}\nStatement A.\n\\end{lemma}\n\n\\begin{lemma}[B]\n\\label{lem:b}\nStatement B.\n\\end{lemma}\n\\begin{proof}\n\\proves{lem:a}\nProof of A, written under B.\n\\end{proof}\n');
    expect(declarations.map((item) => item.label)).toEqual(['lem:a', 'lem:b']);
    expect(declarations[0].proof).toContain('Proof of A');
    expect(declarations[1].proof).toBeNull();
  });

  it('reports a proves target absent from the source', () => {
    const parsed = parseBlueprintLatex('\n\\begin{lemma}[A]\n\\label{lem:a}\nStatement A.\n\\end{lemma}\n\n\\begin{proof}\n\\proves{thm:another-chapter}\n\\leanok\nProof of a statement from elsewhere.\n\\end{proof}\n');
    expect(parsed.declarations.map((item) => item.label)).toEqual(['lem:a']);
    expect(parsed.declarations[0].proof).toBeNull();
    expect(parsed.unattachedProofs).toHaveLength(1);
    expect(parsed.unattachedProofs[0].targetLabel).toBe('thm:another-chapter');
    expect(parsed.unattachedProofs[0].proofLeanok).toBe(true);
    expect(parsed.unattachedProofs[0].proof).toContain('from elsewhere');
  });

  it('stops the proof title scan at the end of the proof', () => {
    const declaration = one('\n\\begin{theorem}\n\\label{thm:bracket}\nStatement.\n\\end{theorem}\n\\begin{proof}\n[This is proof prose.\n\\leanok\n\\end{proof}\n\nLater prose closes a bracket].\n');
    expect(declaration.proof).toBe('[This is proof prose.');
    expect(declaration.proofLeanok).toBe(true);
    expect(declarationStatus(declaration)).toBe('proved');
  });

  it('attributes a proof nested in an outer proof to the nested declaration', () => {
    const declarations = byLabel('\n\\begin{theorem}\n\\label{thm:outer}\nOuter statement.\n\\end{theorem}\n\\begin{proof}\nOuter proof starts.\n\\begin{lemma}\n\\label{lem:inner}\nInner statement.\n\\end{lemma}\n\\begin{proof}\nInner proof.\n\\end{proof}\nOuter proof ends.\n\\end{proof}\n');
    expect(declarations['thm:outer'].proof ?? '').toContain('Outer proof starts.');
    expect(declarations['lem:inner'].proof).toBe('Inner proof.');
  });

  it('does not let a nested proves tag claim the enclosing proof', () => {
    const declarations = byLabel('\n\\begin{theorem}\n\\label{thm:outer}\nOuter statement.\n\\end{theorem}\n\\begin{proof}\nOuter proof.\n\\begin{lemma}\n\\label{lem:inner}\nInner statement.\n\\end{lemma}\n\\begin{proof}\n\\proves{lem:inner}\nInner proof.\n\\end{proof}\n\\end{proof}\n');
    expect(declarations['thm:outer'].proof ?? '').toContain('Outer proof.');
    expect(declarations['lem:inner'].proof).toBe('Inner proof.');
  });

  it('reports a discarded same-file proves claim', () => {
    const declaration = one('\n\\begin{lemma}\n\\label{lem:a}\nStatement.\n\\end{lemma}\n\\begin{proof}\nPositional proof.\n\\end{proof}\n\\begin{proof}\n\\proves{lem:a}\nDetached duplicate proof.\n\\end{proof}\n');
    expect(declaration.proof).toBe('Positional proof.');
    expect(warnings.join('\n')).toContain('Ignoring \\proves{lem:a}');
  });

  it('reports a duplicate proves claim', () => {
    const declaration = one('\n\\begin{lemma}\n\\label{lem:a}\nStatement.\n\\end{lemma}\n\n\\begin{proof}\n\\proves{lem:a}\nFirst linked proof.\n\\end{proof}\n\n\\begin{proof}\n\\proves{lem:a}\nSecond linked proof.\n\\end{proof}\n');
    expect(declaration.proof).toBe('First linked proof.');
    expect(warnings.join('\n')).toContain('Ignoring a second \\proves{lem:a}');
  });

  it('resolves a forward reference', () => {
    const declaration = one('\n\\begin{proof}\n\\proves{thm:later}\nProof written first.\n\\end{proof}\n\n\\begin{theorem}[Later]\n\\label{thm:later}\nStatement written second.\n\\end{theorem}\n');
    expect(declaration.proof).toContain('Proof written first');
  });

  it('lets an adjacent proof beat a later proves link', () => {
    const declaration = one('\n\\begin{lemma}[A]\n\\label{lem:a}\nStatement A.\n\\end{lemma}\n\\begin{proof}\nThe proof written with the statement.\n\\end{proof}\n\n\\begin{proof}\n\\proves{lem:a}\nA duplicate claim, further down.\n\\end{proof}\n');
    expect(declaration.proof).toContain('written with the statement');
  });

  it('strips the proves tag, uses, leanok and the heading from proof prose', () => {
    const declaration = one('\n\\begin{theorem}[Main]\n\\label{thm:main}\nStatement.\n\\end{theorem}\n\n\\begin{proof}[Proof of Theorem~\\ref{thm:main}]\n\\proves{thm:main}\n\\uses{lem:helper}\n\\leanok\nThe real prose.\n\\end{proof}\n');
    expect(declaration.proof).toBe('The real prose.');
  });

  it('falls back to adjacency when the proves tag is commented out', () => {
    const parsed = parseBlueprintLatex('\n\\begin{lemma}[A]\n\\label{lem:a}\nStatement A.\n\\end{lemma}\n\\begin{proof}\n% \\proves{lem:elsewhere}\nProof of the adjacent lemma.\n\\end{proof}\n');
    expect(parsed.unattachedProofs).toEqual([]);
    expect(parsed.declarations[0].proof).toContain('adjacent lemma');
  });

  it('does not leak a nested proves proof leanok into its host', () => {
    const entries = parseBlueprintDeclarations('\n\\begin{theorem}[Host]\n\\label{thm:host}\nHost statement.\n\\begin{proof}\n\\proves{thm:target}\n\\leanok\nProof of the target.\n\\end{proof}\n\\end{theorem}\n\n\\begin{theorem}[Target]\n\\label{thm:target}\nTarget statement.\n\\end{theorem}\n');
    expect(entries.map((entry) => entry.label)).toEqual(['thm:host', 'thm:target']);
    expect(entries[0].proof).toBeNull();
    expect(entries[0].statementLeanok).toBe(false);
    expect(declarationStatus(entries[0])).toBe('not_started');
    expect(entries[1].proof).not.toBeNull();
    expect(entries[1].proofLeanok).toBe(true);
    expect(declarationStatus(entries[1])).toBe('proved');
  });

  it('trims whitespace around a proves label', () => {
    const declaration = one('\n\\begin{lemma}[A]\n\\label{lem:a}\nStatement A.\n\\end{lemma}\n\nProse in between.\n\n\\begin{proof}\n\\proves{ lem:a }\nDetached proof.\n\\end{proof}\n');
    expect(declaration.proof).toContain('Detached proof');
  });
});

describe('fixture project', () => {
  const fixture = path.resolve(__dirname, '../../../../../fixtures/sample-blueprint/blueprint/src/chapters');

  it('parses the sample chapters with the expected statuses', () => {
    const doubling = parseBlueprintDeclarations(fs.readFileSync(path.join(fixture, 'doubling.tex'), 'utf8'));
    expect(doubling.map((item) => [item.label, declarationStatus(item)])).toEqual([
      ['def:twice', 'proved'],
      ['lem:twice-zero', 'proved'],
      ['thm:twice-eq', 'proved'],
    ]);
    expect(doubling[2].uses).toEqual(['def:twice']);
    expect(doubling[2].proof).toBe('By definition.');
    const squares = parseBlueprintDeclarations(fs.readFileSync(path.join(fixture, 'squares.tex'), 'utf8'));
    expect(squares.map((item) => [item.label, declarationStatus(item)])).toEqual([
      ['def:square', 'proved'],
      ['thm:twice-le-square', 'in_progress'],
      ['conj:cube', 'not_started'],
    ]);
    expect(squares[1].leanName).toBe('twice_le_square');
    expect(squares[1].uses).toEqual(['def:twice', 'def:square']);
  });
});
