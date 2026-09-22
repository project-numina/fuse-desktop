import { describe, expect, it, vi } from 'vitest';

// Only the linter factory is stubbed; the parser and language stay real so the
// other cases here still exercise the genuine grammar.
vi.mock('codemirror-lang-latex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('codemirror-lang-latex')>()),
  latexLinter: vi.fn(() => () => []),
}));

import { latexLinter } from 'codemirror-lang-latex';

import { latex, latexLanguage } from '@/lib/latex-language';

describe('LaTeX CodeMirror language', () => {
  it('parses document structure', () => {
    const tree = latexLanguage.parser.parse('\\begin{theorem}x\\end{theorem}');
    expect(tree.length).toBeGreaterThan(0);
  });

  it('builds support with optional editing services disabled', () => {
    const support = latex({
      autoCloseTags: false,
      enableLinting: false,
      enableAutocomplete: false,
      autoCloseBrackets: false,
    });
    expect(support.language).toBe(latexLanguage);
    expect(support.support).toBeDefined();
  });

  // Sources are fragments, so the missing-\begin{document} rule would underline
  // the first 200 characters of every one of them.
  it('lints without the missing-document-environment rule', () => {
    latex({ enableLinting: true });
    expect(latexLinter).toHaveBeenCalledWith(
      expect.objectContaining({ checkMissingDocumentEnv: false }),
    );
  });
});
