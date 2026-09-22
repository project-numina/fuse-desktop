import { describe, it, expect, vi } from 'vitest';
import { renderMath, escapeHtml } from '@/lib/render-math';

describe('escapeHtml', () => {
  it('escapes ampersands, angle brackets', () => {
    expect(escapeHtml('<div>&</div>')).toBe('&lt;div&gt;&amp;&lt;/div&gt;');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('renderMath', () => {
  describe('blueprint math compatibility', () => {
    function rendered(tex: string, macros = {}, references = {}) {
      const html = renderMath(tex, macros, {}, references);
      const element = document.createElement('div');
      element.innerHTML = html;
      expect(element.querySelector('.katex')).not.toBeNull();
      expect(element.querySelector('.katex-error, [style*="color:#cc0000"], [style*="color: #cc0000"]')).toBeNull();
      return element;
    }

    it('renders qedhere without duplicating the proof ending marker', () => {
      const element = rendered(String.raw`\begin{proof}Thus \[x\leq y.\qedhere\]\end{proof}`);
      expect(element.querySelector('.katex-html')?.textContent).toContain('x≤y.');
      expect(element.querySelectorAll('.doc-qed')).toHaveLength(1);
      expect(element.querySelector('.katex-html')?.textContent).not.toContain('\\qedhere');
    });

    it.each(['multline', 'multline*'])('renders %s with line breaks and preserves equation references', env => {
      const label = env === 'multline' ? String.raw`\label{eq:bound}` : '';
      const element = rendered(`\\begin{${env}}${label}a+b\\\\\\leq c+d\\end{${env}}`, {}, {
        'eq:bound': { kind: 'equation', number: '15.1' },
      });
      expect(element.querySelector('.katex-html')?.textContent).toContain('a+b');
      expect(element.querySelector('.katex-html')?.textContent).toContain('≤c+d');
      expect(element.querySelector('.mtable')).not.toBeNull();
      expect(element.querySelector('#eq-eq\\:bound') !== null).toBe(env === 'multline');
      expect(element.querySelector('.katex-html')?.textContent).not.toContain('\\begin');
    });

    it('keeps a brace-protected half-open interval inside the theorem title', () => {
      const element = rendered(String.raw`\begin{lemma}[{Abstract bootstrap on $(\beta,1]$}]
\label{lem:bootstrap}Let $S\subseteq\mathbb{R}$ satisfy
\begin{enumerate}\item $1\in S$.\item $\beta<1$.\end{enumerate}
Then $(\beta,1]\subseteq S$.\end{lemma}`);
      const title = element.querySelector('.doc-decl-title');
      expect(title?.querySelector('.katex-html')?.textContent).toContain('(β,1]');
      expect(title?.textContent).not.toContain('Let');
      expect(element.querySelectorAll('li')).toHaveLength(2);
      expect(element.querySelectorAll('.katex')).toHaveLength(5);
      expect(element.querySelector('[data-decl-label="lem:bootstrap"]')).not.toBeNull();
    });

    it.each([
      String.raw`$\nu_{\ref{lemmain2}}(\beta)$`,
      String.raw`$$\nu_{\ref{lemmain2}}(\beta)$$`,
      String.raw`\(\nu_{\ref{lemmain2}}(\beta)\)`,
      String.raw`\[\nu_{\ref{lemmain2}}(\beta)\]`,
      String.raw`\begin{align}\nu_{\ref{lemmain2}}(\beta)&=1\end{align}`,
    ])('resolves references in every math delimiter: %s', tex => {
      const element = rendered(tex, {}, { lemmain2: { kind: 'lemma', number: '9.11' } });
      expect(element.querySelector('.katex-html')?.textContent).toContain('9.11');
      expect(element.querySelector('.katex-html')?.textContent).not.toContain('lemmain2');
    });

    it('resolves references inside custom macro bodies without mutating them', () => {
      const macros = { loss: String.raw`\nu_{\ref{lemmain2}}` };
      const element = rendered(String.raw`$\loss$`, macros, { lemmain2: '9.11' });
      expect(element.querySelector('.katex-html')?.textContent).toContain('9.11');
      expect(macros.loss).toBe(String.raw`\nu_{\ref{lemmain2}}`);
    });

    it('renders equation and clever references and safely preserves unresolved labels', () => {
      const element = rendered(String.raw`$\eqref{eq:x}+\cref{lem:x}+\ref{missing_label}$`, {}, {
        'eq:x': { kind: 'equation', number: '2.1' }, 'lem:x': { kind: 'lemma', number: '3.2' },
      });
      expect(element.querySelector('.katex-html')?.textContent).toContain('(2.1)');
      expect(element.querySelector('.katex-html')?.textContent?.replace(/\s/g, ' ')).toContain('Lemma 3.2');
      expect(element.querySelector('.katex-html')?.textContent).toContain('missing_label');
    });

    it.each([
      String.raw`\[\bigl(\text{\lstinline{inducedShading}}\ s''\ V''\ W\bigr).\mathrm{shade}\]`,
      String.raw`$\lstinline[language=Lean]|foo_bar|$`,
      String.raw`$\mintinline{lean}/foo_bar/$`,
      String.raw`$\verb|foo_bar|$`,
    ])('renders verbatim inline code inside math: %s', tex => { rendered(tex); });

    it('does not interpret commands or HTML inside verbatim code', () => {
      const element = rendered(String.raw`$\text{\lstinline{\ref{secret}_#&%<script>}}$`);
      expect(element.querySelector('script')).toBeNull();
      expect(element.querySelector('.katex-html')?.textContent).toContain(String.raw`\ref{secret}_#&%<script>`);
      expect(renderMath(String.raw`\mintinline{lean}/Finset.convexHull_biUnion_singleton/`))
        .toBe('<code>Finset.convexHull_biUnion_singleton</code>');
    });

    it.each([
      String.raw`\[\sigma_{\exfact}(\{i\}) = |V_i|^{-\exfact} .\]`,
      String.raw`\(\{i\}\)`,
      String.raw`\[\{x \mid x > 0\}\]`,
    ])('keeps escaped literal braces inside math: %s', tex => {
      const element = rendered(tex, { exfact: String.raw`\eta_{\mathrm{bias}}` });
      expect(element.textContent).not.toContain('\\[');
      expect(element.textContent).not.toContain('\\]');
    });
  });

  // ---- Original tests (must still pass) ----

  it('returns empty string for falsy input', () => {
    expect(renderMath('')).toBe('');
    expect(renderMath(null as any)).toBe('');
    expect(renderMath(undefined as any)).toBe('');
  });

  it('renders plain text without math delimiters', () => {
    const result = renderMath('hello world');
    expect(result).toBe('hello world');
  });

  it('escapes HTML in plain text', () => {
    const result = renderMath('a < b & c > d');
    expect(result).toBe('a &lt; b &amp; c &gt; d');
  });

  it('renders inline math ($...$)', () => {
    const result = renderMath('The formula $x^2$ is simple.');
    expect(result).toContain('katex');
    expect(result).toContain('The formula ');
    expect(result).toContain(' is simple.');
  });

  it('renders display math ($$...$$)', () => {
    const result = renderMath('See: $$x^2 + y^2 = z^2$$');
    expect(result).toContain('katex');
    expect(result).toContain('See: ');
  });

  it('collapses a single newline into a space (LaTeX paragraph rules)', () => {
    const result = renderMath('line one\nline two');
    expect(result).toBe('line one line two');
    expect(result).not.toContain('<br>');
  });

  it('treats a blank line as a paragraph break', () => {
    const result = renderMath('para one\n\npara two');
    expect(result).toContain('paragraph-break');
  });

  it('collapses indented continuation lines into a single space', () => {
    // Imported leanblueprints often indent wrapped lines inside
    // \begin{definition}...\end{definition} blocks. Each newline plus
    // leading whitespace should fold into one space, not multiple.
    const result = renderMath('A function f is\n    automorphic if it satisfies');
    expect(result).toBe('A function f is automorphic if it satisfies');
  });

  it('falls back to raw TeX when KaTeX throws', async () => {
    const katex = await import('katex');
    const spy = vi.spyOn(katex.default, 'renderToString').mockImplementation(() => {
      throw new Error('parse error');
    });

    const inlineResult = renderMath('before $bad$ after');
    expect(inlineResult).toContain('$bad$');

    const displayResult = renderMath('before $$bad$$ after');
    expect(displayResult).toContain('$$bad$$');

    spy.mockRestore();
  });

  // ---- Commands spanning math delimiters ----

  describe('commands spanning math delimiters', () => {
    it('renders \\emph wrapping inline math', () => {
      const result = renderMath('We say $f$ is \\emph{continuous on $[a,b]$} if $f$ is');
      expect(result).toContain('<em>');
      expect(result).toContain('</em>');
      expect(result).toContain('continuous on');
      // The [a,b] should be rendered as math inside the <em>
      expect(result).toContain('katex');
    });

    it('renders \\textbf wrapping inline math', () => {
      const result = renderMath('\\textbf{value is $x^2$ here}');
      expect(result).toContain('<strong>');
      expect(result).toContain('</strong>');
      expect(result).toContain('katex');
    });
  });

  // ---- Nested commands ----

  describe('nested commands', () => {
    it('renders \\textbf{\\emph{text}} correctly', () => {
      const result = renderMath('\\textbf{\\emph{hello}}');
      expect(result).toContain('<strong>');
      expect(result).toContain('<em>');
      expect(result).toContain('hello');
      expect(result).toContain('</em>');
      expect(result).toContain('</strong>');
    });

    it('renders deeply nested commands', () => {
      const result = renderMath('\\emph{a \\textbf{b \\texttt{c}}}');
      expect(result).toContain('<em>');
      expect(result).toContain('<strong>');
      expect(result).toContain('<code>');
      expect(result).toContain('c');
    });
  });

  // ---- Escaped characters ----

  describe('escaped characters', () => {
    it('renders \\$ as literal dollar sign', () => {
      const result = renderMath('Price is \\$50');
      expect(result).toBe('Price is $50');
    });

    it('renders \\{ and \\} as literal braces', () => {
      const result = renderMath('set \\{a, b\\}');
      expect(result).toBe('set {a, b}');
    });

    it('does not enter math mode on escaped dollar', () => {
      const result = renderMath('\\$x\\$');
      expect(result).toBe('$x$');
      expect(result).not.toContain('katex');
    });

    it('renders \\\\ as line break', () => {
      const result = renderMath('line one\\\\line two');
      expect(result).toContain('<br>');
    });

    it('renders \\, as thin space', () => {
      const result = renderMath('a\\,b');
      expect(result).toContain('&thinsp;');
    });
  });

  // ---- Spacing commands ----

  describe('spacing commands', () => {
    it('renders ~ as non-breaking space', () => {
      const result = renderMath('a~b');
      expect(result).toBe('a&nbsp;b');
    });

    it('renders \\quad as em space', () => {
      const result = renderMath('a\\quad b');
      expect(result).toContain('&emsp;');
    });

    it('renders \\qquad as double em space', () => {
      const result = renderMath('a\\qquad b');
      expect(result).toContain('&emsp;&emsp;');
    });

    it('renders \\colon', () => {
      const result = renderMath('f\\colon A');
      expect(result).toContain(':&thinsp;');
    });

    it('renders \\to as arrow', () => {
      const result = renderMath('f\\to g');
      expect(result).toContain('&rarr;');
    });

    it('renders \\ldots as ellipsis', () => {
      const result = renderMath('a, b, \\ldots');
      expect(result).toContain('&hellip;');
    });
  });

  // ---- Formatting commands ----

  describe('formatting commands', () => {
    it('renders \\emph as <em>', () => {
      const result = renderMath('\\emph{hello}');
      expect(result).toBe('<em>hello</em>');
    });

    it('renders \\textbf as <strong>', () => {
      const result = renderMath('\\textbf{bold}');
      expect(result).toBe('<strong>bold</strong>');
    });

    it('renders \\textit as <em>', () => {
      const result = renderMath('\\textit{italic}');
      expect(result).toBe('<em>italic</em>');
    });

    it('renders \\texttt as <code>', () => {
      const result = renderMath('\\texttt{code}');
      expect(result).toBe('<code>code</code>');
    });

    it('handles line-wrapped command arguments', () => {
      const result = renderMath('\\textbf\n{bold}');
      expect(result).toBe('<strong>bold</strong>');
    });

    it('handles line-wrapped \\emph with math inside', () => {
      const result = renderMath('\\emph\n{text $x$}');
      expect(result).toContain('<em>');
      expect(result).toContain('katex');
      expect(result).toContain('</em>');
    });
  });

  // ---- Reference commands ----

  describe('reference commands', () => {
    it('renders \\cref as plain text', () => {
      const result = renderMath('See \\cref{thm:main}');
      expect(result).toBe('See thm:main');
    });

    it('renders \\ref as plain text', () => {
      const result = renderMath('Equation \\ref{eq:1}');
      expect(result).toBe('Equation eq:1');
    });

    it('renders \\eqref as plain text when the label is unknown', () => {
      const result = renderMath('see \\eqref{mugoalml2quant}');
      expect(result).toBe('see mugoalml2quant');
    });

    it('resolves \\eqref to a parenthesised, linked equation number', () => {
      const refs = { eqgoalmuT: { kind: 'equation', number: '9.3' } };
      const result = renderMath('see \\eqref{eqgoalmuT} above', {}, {}, refs);
      expect(result).toContain('class="doc-doc-ref"');
      expect(result).toContain('data-doc-ref="eqgoalmuT"');
      expect(result).toContain('>(9.3)</a>');
    });

    it('resolves \\ref to an equation without the parentheses', () => {
      const refs = { eqgoalmuT: { kind: 'equation', number: '9.3' } };
      expect(renderMath('see \\ref{eqgoalmuT}', {}, {}, refs)).toContain('>9.3</a>');
    });

    it('resolves \\ref to a section as a link to its number', () => {
      const refs = { secmainlemma2: { kind: 'section', number: '9' } };
      const result = renderMath('Section~\\ref{secmainlemma2}', {}, {}, refs);
      expect(result).toContain('data-doc-ref="secmainlemma2"');
      expect(result).toContain('>9</a>');
      expect(result).not.toContain('secmainlemma2<');
    });

    it('prefixes the kind for a \\cref to a subsection', () => {
      const refs = { sub: { kind: 'subsection', number: '9.1' } };
      expect(renderMath('see \\cref{sub}', {}, {}, refs))
        .toContain('>Subsection 9.1</a>');
    });

    it('navigates declarations and document structure by different attributes', () => {
      const refs = {
        'lem:foo': { kind: 'lemma', number: '9.2' },
        'eq:foo': { kind: 'equation', number: '9.3' },
      };
      const result = renderMath('\\ref{lem:foo} and \\eqref{eq:foo}', {}, {}, refs);
      expect(result).toContain('data-uses-ref="lem:foo"');
      expect(result).toContain('data-doc-ref="eq:foo"');
    });
  });

  // ---- Sectioning commands ----

  describe('sectioning commands', () => {
    it('renders a heading with its level class', () => {
      expect(renderMath('\\subsection{Setup}'))
        .toBe('<h3 class="doc-subsection">Setup</h3>');
    });

    it('anchors a heading on the \\label that trails its title', () => {
      const result = renderMath('\\section{Main Lemma 2}\\label{secmainlemma2}');
      expect(result).toContain('id="sec-secmainlemma2"');
      expect(result).toContain('data-doc-anchor="secmainlemma2"');
    });

    it('anchors a heading whose title holds a nested \\ref', () => {
      const result = renderMath('\\subsection{Proofs in \\ref{x}}\\label{extra9Section}');
      expect(result).toContain('data-doc-anchor="extra9Section"');
    });

    it('leaves an unlabelled heading unanchored', () => {
      expect(renderMath('\\section{Setup}')).not.toContain('data-doc-anchor');
    });
  });

  // ---- Strip commands ----

  describe('strip commands', () => {
    it('strips \\label', () => {
      const result = renderMath('\\label{foo}text after');
      expect(result).toBe('text after');
    });

    it('strips \\uses', () => {
      const result = renderMath('\\uses{dep1, dep2}text after');
      expect(result).toBe('text after');
    });

    it('strips \\proves instead of leaking its label into the proof body', () => {
      const result = renderMath('\\proves{lem:ml2redApplyVNS}The cardinality bound');
      expect(result).toBe('The cardinality bound');
    });

    it('renders \\lstinline verbatim, without stripping the command inside', () => {
      const result = renderMath('carries a \\lstinline{\\lean} target');
      expect(result).toBe('carries a <code>\\lean</code> target');
    });

    it('strips \\lean', () => {
      const result = renderMath('\\lean{Nat.add}text after');
      expect(result).toBe('text after');
    });

    it('strips \\leanok', () => {
      const result = renderMath('\\leanok text after');
      expect(result).toBe(' text after');
    });
  });

  // ---- Unknown commands ----

  describe('unknown commands', () => {
    it('preserves argument content for unknown commands with braces', () => {
      const result = renderMath('\\footnote{some text}');
      expect(result).toBe('some text');
    });

    it('strips unknown commands without braces and their delimiter whitespace', () => {
      const result = renderMath('\\noindent text');
      expect(result).toBe('text');
    });

    it('consumes the trailing newline after a standalone unknown command', () => {
      // Regression: \notready (and any other unrecognized standalone
      // metadata command) used to leave its trailing newline behind,
      // which the scanner then rendered as a leading <br> -- showing as
      // a blank line at the top of the blueprint card.
      const result = renderMath('\\notready\nLet $X$ be a space.');
      expect(result).not.toContain('<br>');
      expect(result.startsWith('Let ')).toBe(true);
    });

    it('recursively renders argument of unknown command', () => {
      const result = renderMath('\\unknown{\\emph{inner}}');
      expect(result).toBe('<em>inner</em>');
    });
  });

  // ---- Math delimiters: \(...\) and \[...\] ----

  describe('alternative math delimiters', () => {
    it('renders \\(...\\) as inline math', () => {
      const result = renderMath('The value \\(x^2\\) is positive.');
      expect(result).toContain('katex');
      expect(result).toContain('The value ');
      expect(result).toContain(' is positive.');
    });

    it('renders \\[...\\] as display math', () => {
      const result = renderMath('Consider: \\[x^2 + y^2 = z^2\\]');
      expect(result).toContain('katex');
      expect(result).toContain('Consider: ');
    });

    it('skips \\) inside brace groups within \\(...\\)', () => {
      // \(\text{\)}\) should treat the inner \) as part of the
      // brace group, not as the closing delimiter
      const result = renderMath('\\(\\text{\\)}\\)');
      expect(result).toContain('katex');
    });

    it('skips \\] inside brace groups within \\[...\\]', () => {
      const result = renderMath('\\[\\text{\\]}\\]');
      expect(result).toContain('katex');
    });
  });

  // ---- List environments ----

  describe('list environments', () => {
    it('renders \\begin{enumerate} with items', () => {
      const result = renderMath(
        '\\begin{enumerate}\\item First\\item Second\\end{enumerate}',
      );
      expect(result).toContain('<ol class="latex-list">');
      expect(result).toContain('<li>First</li>');
      expect(result).toContain('<li>Second</li>');
      expect(result).toContain('</ol>');
    });

    it('renders \\begin{itemize} with items', () => {
      const result = renderMath(
        '\\begin{itemize}\\item A\\item B\\end{itemize}',
      );
      expect(result).toContain('<ul class="latex-list">');
      expect(result).toContain('<li>A</li>');
      expect(result).toContain('<li>B</li>');
      expect(result).toContain('</ul>');
    });

    it('renders math inside list items', () => {
      const result = renderMath(
        '\\begin{enumerate}\\item Value $x^2$\\item Done\\end{enumerate}',
      );
      expect(result).toContain('<li>');
      expect(result).toContain('katex');
    });

    it('does not split on \\item inside nested environments', () => {
      const result = renderMath(
        '\\begin{enumerate}\\item Outer\\begin{itemize}\\item Inner\\end{itemize}\\item After\\end{enumerate}',
      );
      expect(result).toContain('<ol class="latex-list">');
      // Extract the top-level <ol> content and count its direct <li> children.
      // The outer <ol> should have exactly 2 items ("Outer..." and "After"),
      // not 3. The inner \item belongs to the nested <ul>.
      const olMatch = result.match(/<ol class="latex-list">([\s\S]*)<\/ol>/);
      expect(olMatch).not.toBeNull();
      const olContent = olMatch![1];
      // Count top-level <li> by splitting on </li> boundaries and filtering
      // out the nested <ul>...</ul> content. A simpler check: the nested
      // <ul> should appear *inside* one of the outer <li> elements.
      expect(olContent).toContain('<ul class="latex-list">');
      // Count direct <li> tags in outer list. The nested <ul> also has <li>
      // tags, but they appear after <ul>. Split at <ul to isolate.
      const beforeNestedList = olContent.split('<ul')[0];
      const afterNestedList = olContent.split('</ul>')[1] || '';
      const outerLiCount = (beforeNestedList.match(/<li>/g) || []).length
        + (afterNestedList.match(/<li>/g) || []).length;
      expect(outerLiCount).toBe(2);
    });

    it('skips optional arguments like [label=(i)]', () => {
      const result = renderMath(
        '\\begin{enumerate}[label=(i)]\\item First\\end{enumerate}',
      );
      expect(result).toContain('<li>First</li>');
      expect(result).not.toContain('label=');
    });
  });

  // ---- Math environments ----

  describe('math environments', () => {
    it('renders \\begin{align} as display math via KaTeX', () => {
      const result = renderMath('\\begin{align}x &= 1\\end{align}');
      expect(result).toContain('katex');
    });

    it('renders \\begin{equation} as display math via KaTeX', () => {
      const result = renderMath('\\begin{equation}E = mc^2\\end{equation}');
      expect(result).toContain('katex');
    });

    it('renders \\begin{cases} as display math via KaTeX', () => {
      const result = renderMath('\\begin{cases}a & b\\\\c & d\\end{cases}');
      expect(result).toContain('katex');
    });

    it('strips \\label inside \\begin{equation} instead of leaking it to KaTeX', () => {
      const result = renderMath(
        '\\begin{equation} \\label{defcf} C_F(K) = 1 \\end{equation}',
      );
      // Renders as math, with no KaTeX error styling and no leaked \label.
      expect(result).toContain('katex');
      expect(result).not.toContain('cc0000');
      expect(result).not.toContain('label');
    });

    it('anchors a labelled equation and tags it with its number', () => {
      const refs = { defcf: { kind: 'equation', number: '9.3' } };
      const result = renderMath(
        '\\begin{equation}\\label{defcf} C_F(K) = 1 \\end{equation}', {}, {}, refs,
      );
      expect(result).toContain('class="doc-equation" id="eq-defcf"');
      expect(result).toContain('data-doc-anchor="defcf"');
      expect(result).toContain('<span class="doc-equation-tag">(9.3)</span>');
      // KaTeX's own eqn-num tag is suppressed, so only our number shows.
      expect(result).not.toContain('eqn-num');
    });

    it('anchors a labelled equation even when its number is unknown', () => {
      const result = renderMath('\\begin{equation}\\label{defcf} x = 1 \\end{equation}');
      expect(result).toContain('data-doc-anchor="defcf"');
      expect(result).not.toContain('doc-equation-tag');
    });

    it('leaves an unlabelled display equation unwrapped', () => {
      const result = renderMath('\\begin{equation}E = mc^2\\end{equation}');
      expect(result).not.toContain('doc-equation');
    });

    it('gives every labelled row of an align its own anchor', () => {
      const refs = {
        first: { kind: 'equation', number: '2.1' },
        second: { kind: 'equation', number: '2.2' },
      };
      const result = renderMath(
        '\\begin{align}\\label{first} x &= 1 \\\\ \\label{second} y &= 2\\end{align}',
        {}, {}, refs,
      );
      // The wrapper anchors the first row; later rows get a zero-size anchor,
      // since a tag can't be positioned per row inside KaTeX's output.
      expect(result).toContain('class="doc-equation" id="eq-first"');
      expect(result).toContain('id="eq-second"');
      expect(result).toContain('(2.1)');
      expect(result).not.toContain('(2.2)');
    });

    it('does not wrap a starred (unnumbered) equation', () => {
      const result = renderMath('\\begin{equation*}\\label{nope} x = 1 \\end{equation*}');
      expect(result).not.toContain('doc-equation');
    });

    it('ignores a commented-out label inside an equation body', () => {
      const refs = { real: { kind: 'equation', number: '6.1' } };
      const result = renderMath(
        '\\begin{equation} % \\label{ghost}\n\\label{real} x = 1 \\end{equation}',
        {}, {}, refs,
      );
      expect(result).toContain('data-doc-anchor="real"');
      expect(result).not.toContain('ghost');
    });

    it('strips \\label inside \\begin{align}', () => {
      const result = renderMath(
        '\\begin{align} x &= 1 \\label{eq:one} \\\\ y &= 2 \\end{align}',
      );
      expect(result).toContain('katex');
      expect(result).not.toContain('cc0000');
      expect(result).not.toContain('label');
    });
  });

  // ---- Graceful degradation for unclosed delimiters ----

  describe('unclosed delimiters', () => {
    it('treats unclosed $ as literal text', () => {
      const result = renderMath('price is $10');
      expect(result).toBe('price is $10');
      expect(result).not.toContain('katex');
    });

    it('treats unclosed $$ as literal text', () => {
      const result = renderMath('start $$unclosed');
      expect(result).toBe('start $$unclosed');
    });

    it('treats unclosed \\( as literal text', () => {
      const result = renderMath('start \\(unclosed');
      expect(result).toBe('start \\(unclosed');
    });

    it('treats unclosed \\[ as literal text', () => {
      const result = renderMath('start \\[unclosed');
      expect(result).toBe('start \\[unclosed');
    });

    it('handles unclosed brace in formatting command', () => {
      const result = renderMath('\\emph{no close');
      // Command stripped, no crash
      expect(result).not.toContain('\\emph');
    });

    it('handles unclosed environment', () => {
      const result = renderMath('\\begin{enumerate}\\item never ends');
      expect(result).toContain('\\begin{enumerate}');
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    it('handles empty display math', () => {
      const result = renderMath('$$$$');
      // Should not crash; may produce empty output
      expect(typeof result).toBe('string');
    });

    it('handles trailing backslash', () => {
      const result = renderMath('text\\');
      expect(result).toBe('text\\');
    });

    it('handles multiple math regions', () => {
      const result = renderMath('$a$ and $b$ and $c$');
      expect(result).toContain('katex');
      expect(result).toContain(' and ');
    });

    it('handles mixed display and inline math', () => {
      const result = renderMath('Inline $x$ then display $$y$$');
      expect(result).toContain('katex');
    });

    it('preserves text around commands', () => {
      const result = renderMath('before \\emph{middle} after');
      expect(result).toBe('before <em>middle</em> after');
    });
  });

  describe('blueprint macros', () => {
    // The macros dict mirrors the backend's wire shape: command names
    // without a leading backslash, bodies in raw LaTeX. We stub the
    // body with a trivially-recognisable KaTeX command so we can
    // assert on the rendered output without dragging KaTeX-specific
    // markup into the expectations.
    const macros = {
      rhobar: '\\bar{\\rho}',
      Q: '\\mathbb{Q}',
      GL: '\\mathrm{GL}',
    };

    it('expands a bare macro use in prose as inline math', () => {
      const result = renderMath('If \\rhobar is modular', macros);
      // KaTeX should emit its markup for the macro body. The
      // surrounding prose is preserved verbatim.
      expect(result).toContain('If ');
      expect(result).toContain(' is modular');
      expect(result).toContain('katex');
    });

    it('expands a macro inside math-mode delimiters', () => {
      const result = renderMath('$\\GL_2(\\Q)$', macros);
      expect(result).toContain('katex');
      // Falls back to raw $...$ when KaTeX rejects the input, which
      // would happen if the macros option wasn't forwarded. The
      // presence of katex markup confirms it parsed cleanly.
      expect(result).not.toContain('$\\GL_2');
    });

    it('consumes trailing subscripts after a prose macro', () => {
      // ``\Q_\ell`` in prose should render as a single inline-math
      // expression rather than rendering ``Q`` then leaving ``_\ell``
      // as stray prose characters.
      const result = renderMath('finite extension of \\Q_\\ell', macros);
      expect(result).toContain('finite extension of ');
      // The whole \Q_\ell expression should land inside a single
      // KaTeX span. KaTeX renders \ell as the ℓ glyph in its visible
      // HTML, so finding that character (outside the hidden source
      // annotation) is a reliable signal that the subscript was
      // included in the math.
      const visibleHtml = result.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
      expect(visibleHtml).toContain('ℓ');
    });

    it('surfaces \\lean, \\leanok, and \\uses as metadata on declarations', () => {
      const source = String.raw`
\begin{definition}[Smooth]
\label{def:smooth}
\lean{Automorphic.GLn.IsSmooth}
\leanok
\uses{def:helper, lem:other}
A function $f$ is smooth if it has property.
\end{definition}`;
      const result = renderMath(source, {});
      // Lean identifier shows as a sidecar row.
      expect(result).toContain('Automorphic.GLn.IsSmooth');
      expect(result).toContain('class="doc-decl-lean"');
      // ``\leanok`` (or a Lean name) promotes the heading badge to
      // "Formalized" when there's no explicit recorded status.
      expect(result).toContain('status-formalized');
      expect(result).toContain('>Formalized<');
      // The declaration is anchored by its own label so \uses links elsewhere
      // can scroll to it, and shows that label visibly so it can be matched.
      expect(result).toContain('data-decl-label="def:smooth"');
      expect(result).toContain('class="doc-decl-tag"');
      expect(result).toContain('>def:smooth</div>');
      // Each dependency renders as a link to its declaration, carrying the
      // target label and keeping the raw label as the visible text.
      expect(result).toContain('class="doc-decl-uses-ref"');
      expect(result).toContain('data-uses-ref="def:helper"');
      expect(result).toContain('>def:helper</a>');
      expect(result).toContain('data-uses-ref="lem:other"');
      expect(result).toContain('>lem:other</a>');
      // The same commands still get stripped from the visible body.
      expect(result).not.toContain('\\lean{');
      expect(result).not.toContain('\\leanok');
      expect(result).not.toContain('\\uses');
    });

    it('renders resolved Lean names with declarative link semantics', () => {
      const source = String.raw`\begin{lemma}
\label{lem:linked}
\lean{Example.linked}
A statement.
\end{lemma}`;

      const linked = renderMath(source, {}, {}, {}, new Set(['lem:linked']));
      const unlinked = renderMath(source);

      expect(linked).toContain(
        'class="doc-decl-lean is-linked" role="link" tabindex="0"',
      );
      expect(unlinked).toContain('class="doc-decl-lean"');
      expect(unlinked).not.toContain('class="doc-decl-lean is-linked"');
    });

    it('promotes the heading badge to Proved when statuses dict says so', () => {
      const source = String.raw`
\begin{theorem}[Main]
\label{thm:main}
\lean{Main.theorem}
The main result.
\end{theorem}`;
      const result = renderMath(source, {}, {
        'thm:main': { status: 'proved', kind: 'theorem' },
      });
      expect(result).toContain('status-proved');
      expect(result).toContain('>Proved<');
    });

    it('renders a terminal declaration with missing kind conservatively', () => {
      const source = String.raw`
\begin{theorem}[Legacy status]
\label{thm:legacy}
The main result.
\end{theorem}`;
      const result = renderMath(source, {}, { 'thm:legacy': 'proved' });
      expect(result).toContain('status-proved');
      expect(result).toContain('>Formalized<');
      expect(result).not.toContain('>Proved<');
    });

    it('renders a terminal statement-only declaration as Formalized, not Proved', () => {
      const source = String.raw`
\begin{definition}[Complete definition]
\label{def:complete}
\lean{Main.completeDefinition}
\leanok
The complete definition.
\end{definition}`;
      const result = renderMath(source, {}, {
        'def:complete': { status: 'proved', kind: 'definition' },
      });
      // It keeps the terminal green treatment while using accurate wording.
      expect(result).toContain('status-proved');
      expect(result).toContain('>Formalized<');
      expect(result).not.toContain('>Proved<');
    });

    it('renders every declaration kind recognized by the backend as an anchored card', () => {
      for (const kind of [
        'axiom', 'conjecture', 'example', 'hypothesis', 'claim', 'assumption',
      ]) {
        const result = renderMath(
          `\\begin{${kind}}\\label{${kind}:one}Body.\\end{${kind}}`,
        );
        expect(result).toContain(`class="doc-decl doc-decl-${kind}"`);
        expect(result).toContain(`data-decl-label="${kind}:one"`);
      }
    });

    it('substitutes \\ref with the chapter number when known', () => {
      const result = renderMath(
        'see Chapter \\ref{ch_overview} for details',
        {},
        {},
        { ch_overview: '4' },
      );
      expect(result).toContain('Chapter 4 for details');
      expect(result).not.toContain('ch_overview');
    });

    it('keeps the raw label for \\ref when no target is known', () => {
      const result = renderMath('see Chapter \\ref{ch_overview}');
      expect(result).toContain('Chapter ch_overview');
    });

    it('resolves a declaration \\ref to its number as a link', () => {
      const refs = { 'def:foo': { kind: 'definition', number: '2.1' } };
      const result = renderMath('see \\ref{def:foo} here', {}, {}, refs);
      expect(result).toContain('class="doc-decl-ref"');
      expect(result).toContain('data-uses-ref="def:foo"');
      expect(result).toContain('>2.1</a>');
      expect(result).not.toContain('def:foo<');
    });

    it('prefixes the kind for a declaration \\cref', () => {
      const refs = { 'def:foo': { kind: 'definition', number: '2.1' } };
      const result = renderMath('see \\cref{def:foo} here', {}, {}, refs);
      expect(result).toContain('>Definition 2.1</a>');
    });

    it('renders {\\tt name} as inline code', () => {
      const result = renderMath('use {\\tt mathlib} for this');
      expect(result).toContain('<code>mathlib</code>');
      expect(result).not.toContain('{');
      expect(result).not.toContain('}');
    });

    it('drops unmatched braces around plain content', () => {
      const result = renderMath('a {plain} group');
      expect(result).toBe('a plain group');
    });

    it('renders \\href{url}{text} as a clickable link', () => {
      const result = renderMath('source \\href{https://example.com/x}{here} ok');
      expect(result).toContain('<a href="https://example.com/x"');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener noreferrer"');
      expect(result).toContain('>here</a>');
      // The URL must not also leak as raw text alongside the link.
      expect(result.match(/https:\/\/example\.com\/x/g)?.length).toBe(1);
    });

    it('drops the URL but keeps the text for unsafe href schemes', () => {
      const result = renderMath('\\href{javascript:alert(1)}{click me}');
      expect(result).not.toContain('href=');
      expect(result).not.toContain('javascript:');
      expect(result).toContain('click me');
    });

    it('renders \\url{url} as an autolink', () => {
      const result = renderMath('see \\url{https://example.com}');
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain('>https://example.com</a>');
    });

    it('strips LaTeX line comments from prose', () => {
      const source = 'visible % hidden because comment\nnext line still visible';
      const result = renderMath(source);
      expect(result).toContain('visible');
      expect(result).toContain('next line still visible');
      expect(result).not.toContain('hidden');
      expect(result).not.toContain('%');
    });

    it('keeps escaped percent signs (\\%) as literal text', () => {
      const result = renderMath('5\\% growth');
      expect(result).toContain('5% growth');
    });

    it('falls back to Unformalized when nothing connects the decl to Lean', () => {
      const source = String.raw`
\begin{lemma}
\label{lem:bare}
A statement with no Lean ties.
\end{lemma}`;
      const result = renderMath(source);
      expect(result).toContain('status-unformalized');
      expect(result).toContain('>Unformalized<');
    });

    it('leaves unknown commands alone when no macros are supplied', () => {
      const result = renderMath('If \\rhobar holds');
      // Falls into the existing unknown-command behaviour: the
      // command is stripped, surrounding text preserved.
      expect(result).toContain('If ');
      expect(result).toContain(' holds');
      expect(result).not.toContain('katex');
    });
  });
});
