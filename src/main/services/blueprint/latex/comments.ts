/**
 * Comment masking and physical-line primitives shared by the blueprint
 * parser, the include walker, validation and the tag writer.
 *
 * Offsets matter everywhere here: every structural scan searches a
 * comment-masked copy of the source and slices values out of the original,
 * so masking must preserve length. Lines are physical LF-terminated lines
 * only. TeX comments run to the next LF, and treating form feeds, NEL or
 * U+2028/9 as line breaks (as `String.prototype.split(/\r?\n/)` variants and
 * Python's `splitlines` do) would let a command hide behind a comment marker.
 */

// Inline verbatim: `\verb|...|` with any non-letter, non-space, non-star
// delimiter. Python's `.` (without DOTALL) matches everything but LF, so the
// body is written as `[^\n]` rather than `.` (which in JS also stops at CR
// and the Unicode line separators).
const VERB_PATTERN = /\\verb\*?([^a-zA-Z\s*])((?:(?!\1)[^\n])*)\1/g;
// hyperref-style commands whose argument is percent-encoded data, not a comment.
const URLISH_PATTERN = /\\(?:url|nolinkurl|path|href)\b\s*\{/g;

export const LATEX_OPAQUE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'verbatim',
  'verbatim*',
  'lstlisting',
  'minted',
  'comment',
]);

/** Escape a literal for use inside a RegExp source (Python's `re.escape`). */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OPAQUE_BEGIN_PATTERN = new RegExp(
  '\\\\begin\\s*\\{(' + [...LATEX_OPAQUE_ENVIRONMENTS].map(escapeRegExp).join('|') + ')\\}',
);

/** Return whether the character at `index` follows an odd run of backslashes. */
export function characterIsEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] === '\\') {
    backslashes += 1;
    cursor -= 1;
  }
  return backslashes % 2 === 1;
}

/** Spans of one line whose percent characters are command argument data. */
function urlishSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const pattern = new RegExp(URLISH_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < line.length && depth) {
      if (line[index] === '{' && !characterIsEscaped(line, index)) depth += 1;
      else if (line[index] === '}' && !characterIsEscaped(line, index)) depth -= 1;
      index += 1;
    }
    spans.push([match.index, index]);
  }
  return spans;
}

/**
 * Return the index of the first real comment marker in one physical line.
 *
 * Escaped percent characters and percent-encoded values inside the URL-like
 * commands supported by hyperref are source text, not comments.
 */
export function latexCommentStart(line: string): number | null {
  const spans = urlishSpans(line);
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '%' || spans.some(([start, end]) => start <= index && index < end)) continue;
    if (!characterIsEscaped(line, index)) return index;
  }
  return null;
}

/** Strip a real percent comment from one physical source line. */
export function stripLatexComment(line: string): string {
  const start = latexCommentStart(line);
  return start === null ? line : line.slice(0, start);
}

/**
 * Split only at LF (and CRLF), never at the extra Unicode separators.
 *
 * With `keepEnds` each line keeps its terminator; otherwise a trailing CR is
 * stripped. An empty tail after the final LF is dropped; `''` gives `[]`.
 */
export function splitLatexPhysicalLines(text: string, keepEnds = false): string[] {
  if (!text) return [];
  const chunks = text.split('\n');
  const lines: string[] = [];
  for (let index = 0; index < chunks.length - 1; index += 1) {
    const chunk = chunks[index];
    if (keepEnds) lines.push(chunk + '\n');
    else lines.push(chunk.endsWith('\r') ? chunk.slice(0, -1) : chunk);
  }
  const last = chunks[chunks.length - 1];
  if (last) lines.push(last);
  return lines;
}

/** Python's `str.rstrip('\r')`: drop every trailing CR. */
function stripTrailingCarriageReturns(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === '\r') end -= 1;
  return line.slice(0, end);
}

/**
 * Blank comments with spaces while preserving every character offset.
 *
 * An unescaped percent sign starts a comment through the end of its physical
 * line; the CR of a CRLF pair is kept so the masked string stays aligned.
 */
export function maskLatexComments(text: string): string {
  const lines = text.split('\n');
  const masked: string[] = [];
  for (const line of lines) {
    const start = latexCommentStart(line);
    if (start === null) {
      masked.push(line);
      continue;
    }
    const end = stripTrailingCarriageReturns(line).length;
    masked.push(line.slice(0, start) + ' '.repeat(end - start) + line.slice(end));
  }
  return masked.join('\n');
}

/** Mask inline `\verb` commands (delimiters included) while preserving offsets. */
export function maskLatexInlineVerbs(line: string): string {
  return line.replace(VERB_PATTERN, (match) => ' '.repeat(match.length));
}

/** The canonical closing-marker pattern for an opaque environment. */
export function latexOpaqueEndPattern(environment: string): RegExp {
  return new RegExp('\\\\end\\s*\\{' + escapeRegExp(environment) + '\\}');
}

/**
 * Return one `[lineNumber, visible]` entry per physical line (1-based).
 *
 * `visible` has the same length as the raw line, with comments, inline
 * `\verb` arguments and the bodies of opaque environments (verbatim, minted,
 * ...) replaced by spaces, so that an example `\input` written as data is not
 * treated as a command. Include discovery, expansion and validation all read
 * this view.
 */
export function iterLatexCommandLines(source: string): Array<[number, string]> {
  const result: Array<[number, string]> = [];
  let opaqueEnvironment: string | null = null;
  const rawLines = splitLatexPhysicalLines(source, true);
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const rawLine = rawLines[lineIndex];
    const lineNumber = lineIndex + 1;
    const visible: string[] = new Array<string>(rawLine.length).fill(' ');
    let cursor = 0;
    if (opaqueEnvironment !== null) {
      const closing = latexOpaqueEndPattern(opaqueEnvironment).exec(rawLine);
      if (closing === null) {
        result.push([lineNumber, visible.join('')]);
        continue;
      }
      cursor = closing.index + closing[0].length;
      opaqueEnvironment = null;
    }

    while (cursor < rawLine.length) {
      let normal = maskLatexInlineVerbs(rawLine.slice(cursor));
      const commentStart = latexCommentStart(normal);
      if (commentStart !== null) normal = normal.slice(0, commentStart);
      const opening = OPAQUE_BEGIN_PATTERN.exec(normal);
      if (opening === null) {
        for (let index = 0; index < normal.length; index += 1) visible[cursor + index] = normal[index];
        break;
      }
      for (let index = 0; index < opening.index; index += 1) visible[cursor + index] = normal[index];
      const environment = opening[1];
      const openingEnd = cursor + opening.index + opening[0].length;
      const closingPattern = new RegExp(latexOpaqueEndPattern(environment).source, 'g');
      closingPattern.lastIndex = openingEnd;
      const closing = closingPattern.exec(rawLine);
      if (closing === null) {
        opaqueEnvironment = environment;
        break;
      }
      cursor = closing.index + closing[0].length;
    }

    result.push([lineNumber, visible.join('')]);
  }
  return result;
}
