import { act, renderHook } from '@testing-library/react';

import { useLatexParser } from '@/features/blueprint/hooks/latex-parser';

function parseStatus(kind: string): string {
  const { result } = renderHook(() => useLatexParser(null));
  act(() => {
    result.current.setLatexSource(
      `\\begin{${kind}}\n`
      + `\\label{${kind}:main}\n`
      + '\\leanok\n'
      + `A ${kind} statement.\n`
      + `\\end{${kind}}`,
    );
  });
  return result.current.parsedEntries[0]?.status ?? '';
}

function parse(source: string) {
  const { result } = renderHook(() => useLatexParser(null));
  act(() => {
    result.current.setLatexSource(source);
  });
  return result.current;
}

describe('useLatexParser declaration status', () => {
  it.each([
    'theorem',
    'lemma',
    'corollary',
    'proposition',
    'example',
    'claim',
  ])('keeps proof-required %s declarations in progress without a proof', (kind) => {
    expect(parseStatus(kind)).toBe('in_progress');
  });

  it.each([
    'definition',
    'axiom',
    'conjecture',
    'remark',
    'hypothesis',
    'assumption',
    'notation',
  ])('makes statement-only %s declarations terminal when formalized', (kind) => {
    expect(parseStatus(kind)).toBe('proved');
  });
});

describe('useLatexParser comment handling', () => {
  // The starter chapter ships its example theorem fully commented out.
  const commentedChapter = '\\section{Example Chapter}\n'
    + '\n'
    + '% \\begin{theorem}\n'
    + '%     \\label{thm:example}\n'
    + '%     Informal statement of a theorem.\n'
    + '% \\end{theorem}\n'
    + '% \\begin{proof}\n'
    + '%     Informal proof sketch.\n'
    + '% \\end{proof}\n';

  it('produces no entry for a commented-out declaration', () => {
    expect(parse(commentedChapter).parsedEntries).toEqual([]);
  });

  it('leaves a commented-out declaration as plain code, not a card', () => {
    const { latexSegments } = parse(commentedChapter);
    expect(latexSegments.every((segment) => segment.type === 'code')).toBe(true);
    // The editor still shows every line it was given.
    expect(latexSegments.map((segment) => segment.text).join('\n')).toBe(commentedChapter);
  });

  it('keeps a declaration next to a commented-out one', () => {
    const { parsedEntries, latexSegments } = parse(
      '% \\begin{lemma}\n'
      + '% \\label{lem:retired}\n'
      + '% Retired.\n'
      + '% \\end{lemma}\n'
      + '\n'
      + '\\begin{lemma}\n'
      + '\\label{lem:live}\n'
      + 'Live.\n'
      + '\\end{lemma}\n',
    );
    expect(parsedEntries.map((entry) => entry.label)).toEqual(['lem:live']);
    expect(parsedEntries[0].statement).toBe('Live.');
    const declarations = latexSegments.filter((segment) => segment.type === 'decl');
    expect(declarations).toHaveLength(1);
    expect(declarations[0].entry?.label).toBe('lem:live');
  });

  it('ignores a commented-out label, uses and leanok', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}\n'
      + '% \\label{thm:commented}\n'
      + '\\label{thm:real}\n'
      + '% \\uses{def:commented}\n'
      + '\\uses{def:real}\n'
      + '% \\leanok\n'
      + 'A statement.\n'
      + '\\end{theorem}\n',
    );
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].label).toBe('thm:real');
    expect(parsedEntries[0].uses).toEqual(['def:real']);
    expect(parsedEntries[0].status).toBe('not_started');
  });

  it('does not treat an escaped percent as a comment', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}\n'
      + 'At most 5\\% of points. \\label{thm:percent}\n'
      + '\\end{theorem}\n',
    );
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].label).toBe('thm:percent');
    expect(parsedEntries[0].statement).toBe('At most 5\\% of points.');
  });

  it('does not treat a percent-encoded URL as a comment', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}\n'
      + '\\url{https://example.com/a%20b} \\label{thm:url}\n'
      + '\\end{theorem}\n',
    );
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].label).toBe('thm:url');
  });

  it('does not extend an unclosed URL argument onto later lines', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}\n'
      + '\\url{broken\n'
      + '% \\end{theorem}\n'
      + '\\label{thm:url-line}\n'
      + '\\end{theorem}\n',
    );
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].label).toBe('thm:url-line');
  });
});

describe('useLatexParser duplicate labels', () => {
  // Two declarations may share a \label — real imported blueprints (FLT) do.
  // Each still has to become its own card with its own content, so every card
  // identity is per-occurrence rather than per-label.
  const duplicated = '\\begin{theorem}[First]\n'
    + '\\label{thm:dup}\n'
    + 'First statement.\n'
    + '\\end{theorem}\n'
    + '\n'
    + '\\begin{theorem}[Second]\n'
    + '\\label{thm:dup}\n'
    + 'Second statement.\n'
    + '\\end{theorem}\n';

  it('parses both declarations', () => {
    const { parsedEntries } = parse(duplicated);
    expect(parsedEntries.map((entry) => entry.label)).toEqual(['thm:dup', 'thm:dup']);
    expect(parsedEntries.map((entry) => entry.statement)).toEqual([
      'First statement.',
      'Second statement.',
    ]);
  });

  it('gives each declaration segment its own entry', () => {
    const declarations = parse(duplicated).latexSegments.filter(
      (segment) => segment.type === 'decl',
    );
    expect(declarations).toHaveLength(2);
    expect(declarations[0].entry?.title).toBe('First');
    expect(declarations[1].entry?.title).toBe('Second');
    expect(declarations[0].entry?.statement).toBe('First statement.');
    expect(declarations[1].entry?.statement).toBe('Second statement.');
  });

  it('gives each declaration segment a distinct key', () => {
    const declarations = parse(duplicated).latexSegments.filter(
      (segment) => segment.type === 'decl',
    );
    expect(declarations.map((segment) => segment.declKey)).toEqual([
      'thm:dup#0',
      'thm:dup#1',
    ]);
  });

  it('keeps a declaration key stable when an unrelated one is added above', () => {
    const keysOf = (source: string) => parse(source).latexSegments
      .filter((segment) => segment.type === 'decl')
      .map((segment) => segment.declKey);
    const before = keysOf(duplicated);
    const after = keysOf(
      '\\begin{lemma}[Added]\n\\label{lem:new}\nS.\n\\end{lemma}\n\n' + duplicated,
    );
    expect(after).toEqual(['lem:new#0', ...before]);
  });
});

describe('useLatexParser \\proves attribution', () => {
  it('attaches a non-adjacent proof to the declaration it proves', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}[Foo]\n'
      + '\\label{thm:foo}\n'
      + 'The statement of foo.\n'
      + '\\end{theorem}\n'
      + '\n'
      + 'Some section prose in between.\n'
      + '\n'
      + '\\begin{proof}\n'
      + '\\proves{thm:foo}\n'
      + '\\leanok\n'
      + 'The detached proof of foo.\n'
      + '\\end{proof}\n',
    );
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].proof).toContain('detached proof of foo');
    expect(parsedEntries[0].status).toBe('proved');
  });

  it('does not let the preceding declaration claim a \\proves proof', () => {
    const { parsedEntries } = parse(
      '\\begin{lemma}[A]\n'
      + '\\label{lem:a}\n'
      + 'Statement A.\n'
      + '\\end{lemma}\n'
      + '\n'
      + '\\begin{lemma}[B]\n'
      + '\\label{lem:b}\n'
      + 'Statement B.\n'
      + '\\end{lemma}\n'
      + '\\begin{proof}\n'
      + '\\proves{lem:a}\n'
      + 'Proof of A, written under B.\n'
      + '\\end{proof}\n',
    );
    expect(parsedEntries.map((entry) => entry.label)).toEqual(['lem:a', 'lem:b']);
    expect(parsedEntries[0].proof).toContain('Proof of A');
    expect(parsedEntries[1].proof).toBeNull();
  });

  it('resolves a proof written before its statement', () => {
    const { parsedEntries } = parse(
      '\\begin{proof}\n'
      + '\\proves{thm:later}\n'
      + 'Proof written first.\n'
      + '\\end{proof}\n'
      + '\n'
      + '\\begin{theorem}[Later]\n'
      + '\\label{thm:later}\n'
      + 'Statement written second.\n'
      + '\\end{theorem}\n',
    );
    expect(parsedEntries[0].proof).toContain('Proof written first');
  });

  it('keeps the proof written with the statement over a later \\proves claim', () => {
    const { parsedEntries } = parse(
      '\\begin{lemma}[A]\n'
      + '\\label{lem:a}\n'
      + 'Statement A.\n'
      + '\\end{lemma}\n'
      + '\\begin{proof}\n'
      + 'The proof written with the statement.\n'
      + '\\end{proof}\n'
      + '\n'
      + '\\begin{proof}\n'
      + '\\proves{lem:a}\n'
      + 'A duplicate claim, further down.\n'
      + '\\end{proof}\n',
    );
    expect(parsedEntries[0].proof).toContain('written with the statement');
  });

  it('drops the \\proves tag and the proof heading from the prose', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}[Main]\n'
      + '\\label{thm:main}\n'
      + 'Statement.\n'
      + '\\end{theorem}\n'
      + '\n'
      + '\\begin{proof}[Proof of Theorem~\\ref{thm:main}]\n'
      + '\\proves{thm:main}\n'
      + '\\leanok\n'
      + 'The real prose.\n'
      + '\\end{proof}\n',
    );
    expect(parsedEntries[0].proof).toBe('The real prose.');
  });

  it('leaves a \\proves proof out of the preceding declaration segment', () => {
    const { latexSegments } = parse(
      '\\begin{lemma}[B]\n'
      + '\\label{lem:b}\n'
      + 'Statement B.\n'
      + '\\end{lemma}\n'
      + '\\begin{proof}\n'
      + '\\proves{lem:a}\n'
      + 'Proof of A.\n'
      + '\\end{proof}\n',
    );
    const declaration = latexSegments.find((segment) => segment.type === 'decl');
    expect(declaration?.text).not.toContain('\\begin{proof}');
    expect(
      latexSegments.some(
        (segment) => segment.type === 'code' && segment.text.includes('\\proves{lem:a}'),
      ),
    ).toBe(true);
  });

  it('still absorbs an adjacent proof that \\proves its own statement', () => {
    const { latexSegments } = parse(
      '\\begin{lemma}[A]\n'
      + '\\label{lem:a}\n'
      + 'Statement A.\n'
      + '\\end{lemma}\n'
      + '\\begin{proof}\n'
      + '\\proves{lem:a}\n'
      + 'Proof of A.\n'
      + '\\end{proof}\n',
    );
    const declaration = latexSegments.find((segment) => segment.type === 'decl');
    expect(declaration?.text).toContain('\\begin{proof}');
  });

  it('keeps an unmatched leading bracket as proof prose', () => {
    const { parsedEntries } = parse(
      '\\begin{theorem}\n'
      + '\\label{thm:bracket}\n'
      + 'Statement.\n'
      + '\\end{theorem}\n'
      + '\\begin{proof}\n'
      + '[This is proof prose.\n'
      + '\\leanok\n'
      + '\\end{proof}\n'
      + '\n'
      + 'Later prose closes a bracket].\n',
    );

    expect(parsedEntries[0].proof).toBe('[This is proof prose.');
    expect(parsedEntries[0].status).toBe('proved');
  });

  it('indexes nested proof blocks and keeps nested \\proves ownership local', () => {
    const { parsedEntries, latexSegments } = parse(
      '\\begin{theorem}\n'
      + '\\label{thm:outer}\n'
      + 'Outer statement.\n'
      + '\\end{theorem}\n'
      + '\\begin{proof}\n'
      + 'Outer proof.\n'
      + '\\begin{lemma}\n'
      + '\\label{lem:inner}\n'
      + 'Inner statement.\n'
      + '\\end{lemma}\n'
      + '\\begin{proof}\n'
      + '\\proves{lem:inner}\n'
      + 'Inner proof.\n'
      + '\\end{proof}\n'
      + '\\end{proof}\n',
    );

    const byLabel = new Map(parsedEntries.map((entry) => [entry.label, entry]));
    expect(byLabel.get('thm:outer')?.proof).toContain('Outer proof.');
    expect(byLabel.get('lem:inner')?.proof).toBe('Inner proof.');
    const declaration = latexSegments.find((segment) => segment.type === 'decl');
    expect(declaration?.text).toContain('\\proves{lem:inner}');
  });
});

describe('useLatexParser server proof merge', () => {
  it('retains a proof parsed from a different source file by the server', () => {
    const blueprint = {
      blueprint_content: '\\begin{theorem}\n'
        + '\\label{thm:detached}\n'
        + 'Statement.\n'
        + '\\end{theorem}\n',
      entries: [{
        kind: 'theorem',
        label: 'thm:detached',
        title: 'thm:detached',
        statement: 'Statement.',
        proof: 'Proof parsed from another chapter.',
        leanName: '',
        leanFile: '',
        uses: [],
        status: 'not_started',
      }],
    };
    const { result } = renderHook(() => useLatexParser(blueprint));

    act(() => result.current.initFromBlueprint());

    expect(result.current.parsedEntries[0].proof).toBe(
      'Proof parsed from another chapter.',
    );
  });
});
