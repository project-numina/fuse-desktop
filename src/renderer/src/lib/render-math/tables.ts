/**
 * Dispatch tables for the LaTeX→HTML renderer. All command behaviour is
 * table-driven; add new commands by editing these tables, not by writing new
 * scanner logic. Extracted from mathRender.ts so the engine stays focused.
 */

/** Formatting commands: wrap argument in an HTML tag, recurse on content. */
export const FORMATTING_COMMANDS: Record<string, string> = {
  emph: 'em',
  textbf: 'strong',
  textit: 'em',
  texttt: 'code',
};

/**
 * Reference commands: resolve the argument against the reference
 * index and render the target's number, linked when it resolves.
 * ``\eqref`` parenthesises the number the way amsmath does.
 */
export const REFERENCE_COMMANDS = new Set(['cref', 'ref', 'eqref']);

/**
 * Reference kinds indexed by ``documentRefs`` rather than by the
 * declaration parser. These navigate via ``data-doc-ref`` (anchor in
 * the rendered prose) instead of ``data-uses-ref`` (declaration block).
 */
export const DOCUMENT_REFERENCE_KINDS = new Set([
  'section', 'subsection', 'subsubsection', 'equation',
]);

/** Strip commands: consume argument silently. */
export const STRIP_COMMANDS = new Set([
  'label', 'uses', 'proves', 'lean', 'leanfile', 'leanok',
  // Build wrappers and cross-file includes — the include chain is
  // already flattened on read, so these are noise in the body.
  'input', 'include',
]);

/**
 * Matches any STRIP_COMMANDS occurrence — ``\cmd{arg}`` or the
 * argument-less ``\cmd`` form (e.g. ``\leanok``). The ``(?![a-zA-Z])``
 * lookahead anchors the command name so ``\lean`` does not match inside
 * ``\leanok``. Used to scrub these document-level commands from
 * math-environment bodies, which bypass the prose scanner that would
 * otherwise consume them via STRIP_COMMANDS.
 */
export const STRIP_COMMAND_PATTERN = new RegExp(
  `\\\\(?:${[...STRIP_COMMANDS].join('|')})(?![a-zA-Z])\\s*(?:\\{[^}]*\\})?`,
  'g',
);

/** Sectioning commands mapped to HTML heading tags. */
export const SECTIONING_COMMANDS: Record<string, string> = {
  chapter: 'h1',
  section: 'h2',
  subsection: 'h3',
  subsubsection: 'h4',
  paragraph: 'h5',
};

/**
 * Old-style LaTeX font shorthands that work as ``{\name text}``. The
 * brace group scopes the font change to its contents; we render it
 * as the equivalent HTML tag.
 */
export const FONT_GROUP_TAGS: Record<string, string> = {
  tt: 'code',
  texttt: 'code',
  bf: 'strong',
  textbf: 'strong',
  it: 'em',
  em: 'em',
  textit: 'em',
  sl: 'em',
  sf: 'span',
  rm: 'span',
  sc: 'span',
};

/**
 * leanblueprint declaration environments. Each emits a structured
 * block with a "Definition 1." / "Theorem 1." / ... heading and the
 * body content. Numbering is handled in CSS via counters keyed by
 * the ``doc-decl-{name}`` class.
 */
export const DECLARATION_ENVIRONMENTS = new Set([
  'definition', 'theorem', 'lemma', 'corollary',
  'proposition', 'axiom', 'conjecture', 'example',
  'remark', 'hypothesis', 'claim', 'assumption', 'notation',
]);

/**
 * Math environments: pass the full `\begin{...}...\end{...}` block to KaTeX
 * as display math. `array` is intentionally excluded -- it is only meaningful
 * inside math mode where KaTeX already handles it within `$...$` blocks.
 */
export const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*',
  'align', 'align*',
  'gather', 'gather*',
  'multline', 'multline*',
  'cases', 'cases*',
  'split',
  'matrix', 'pmatrix', 'bmatrix', 'vmatrix',
]);

/**
 * Math environments that LaTeX numbers, and whose ``\label{...}``
 * therefore names an equation the reader can ``\eqref``. The starred
 * forms are unnumbered, and `split` / `cases` / the matrix family only
 * ever appear nested inside one of these.
 */
export const NUMBERED_MATH_ENVIRONMENTS = new Set([
  'equation', 'align', 'gather', 'multline',
]);

/** No-argument spacing commands mapped to HTML entities. */
export const SPACING_MAP: Record<string, string> = {
  quad: '&emsp;',
  qquad: '&emsp;&emsp;',
  colon: ':&thinsp;',
  to: '&rarr; ',
  ldots: '&hellip;',
};

/** Characters that form a literal escape when preceded by `\`. */
export const ESCAPED_CHARS = '${}%#&_';

/** Maximum recursion depth for nested command arguments. */
export const MAX_DEPTH = 50;
