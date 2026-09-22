/**
 * Builds the ``\label{...}`` → number index for the parts of a blueprint
 * the declaration parser doesn't see: sectioning commands and numbered
 * display equations.
 *
 * The backend ships an entry per declaration (lemma, definition, …) and a
 * number per chapter, so ``\ref{lem:foo}`` and ``\ref{ch:intro}`` already
 * resolve. Everything else — ``\ref{sec:reduction}``, ``\eqref{eqgoalmuT}``
 * — has no target, and the renderer falls back to printing the raw label.
 * This module scans the chapter sources for those labels so they resolve
 * too.
 *
 * Numbering mirrors the declaration scheme in the reading view: a chapter
 * file *is* a section, and its number is its position in the include order.
 * Within a file, subsections count from 1 and equations count from 1.
 *
 * Only *labelled* equations consume an equation number. A real LaTeX build
 * numbers every row of a numbered environment, labelled or not, so our
 * numbers can drift from a PDF's. They stay self-consistent, though: the
 * renderer prints the tag next to the equation from this same index, so the
 * ``(9.3)`` in the prose always matches the ``(9.3)`` on the display.
 */

import {
  findEndEnvironment,
  findMatchingBrace,
  readEquationLabels,
  readTrailingLabel,
  skipOptionalWhitespace,
  stripLatexComments,
  type ReferenceTarget,
} from '@/lib/render-math/scan-helpers';
import { NUMBERED_MATH_ENVIRONMENTS } from '@/lib/render-math/tables';

/** A chapter file to index, with the section number it numbers under. */
export interface ChapterSource {
  /** Repo-relative ``.tex`` path; the value stored per label. */
  path: string;
  /** Raw LaTeX source. */
  source: string;
  /** The file's section number ("9" in "9.3"). */
  sectionNumber: number;
}

export interface DocumentReferenceIndex {
  /** label → kind + number, merged into the renderer's reference dict. */
  references: Record<string, ReferenceTarget>;
  /** label → the chapter file that defines it, for cross-chapter jumps. */
  chapterByLabel: Record<string, string>;
}

// A sectioning command or the opening of a math environment. Kept as a
// source string so each scan gets its own regex — the scan mutates
// ``lastIndex`` to skip over bodies it has already consumed.
const TOKEN_SOURCE = String.raw`\\(subsubsection|subsection|section)(?![a-zA-Z])`
  + String.raw`|\\begin\{([a-zA-Z]+\*?)\}`;

/** Per-file counters, reset the way LaTeX resets them. */
interface Counters {
  subsection: number;
  subsubsection: number;
  equation: number;
}

/**
 * Position just past a sectioning command's title argument, skipping the
 * optional ``[short title]`` that precedes it. Returns -1 when the braces
 * are unbalanced or absent.
 */
function skipHeadingArgument(source: string, pos: number): number {
  let cursor = skipOptionalWhitespace(source, pos);
  if (source[cursor] === '[') {
    // Bracket-depth scan so a ``]`` inside the short title (e.g. ``$A[0]$``)
    // doesn't close it early and desync the counters.
    let depth = 1;
    cursor += 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '[') depth += 1;
      else if (source[cursor] === ']') depth -= 1;
      cursor += 1;
    }
    if (depth > 0) return -1;
    cursor = skipOptionalWhitespace(source, cursor);
  }
  if (source[cursor] !== '{') return -1;
  const close = findMatchingBrace(source, cursor);
  return close === -1 ? -1 : close + 1;
}

/** Advance the counters for a heading and return its number string. */
function numberForHeading(
  level: string, sectionNumber: number, counters: Counters,
): string {
  if (level === 'section') {
    counters.subsection = 0;
    counters.subsubsection = 0;
    return String(sectionNumber);
  }
  if (level === 'subsection') {
    counters.subsection += 1;
    counters.subsubsection = 0;
    return `${sectionNumber}.${counters.subsection}`;
  }
  counters.subsubsection += 1;
  return `${sectionNumber}.${counters.subsection}.${counters.subsubsection}`;
}

/**
 * Every section/subsection/equation label in one chapter's source, in
 * document order, numbered under ``sectionNumber``.
 */
export function scanDocumentLabels(
  rawSource: string, sectionNumber: number,
): Array<{ label: string; kind: string; number: string }> {
  // Blank comments first so a commented-out ``\subsection`` or
  // ``\begin{equation}\label{...}`` doesn't consume a number the visible
  // (comment-skipping) renderer never assigns.
  const source = stripLatexComments(rawSource);
  const found: Array<{ label: string; kind: string; number: string }> = [];
  const counters: Counters = { subsection: 0, subsubsection: 0, equation: 0 };
  const pattern = new RegExp(TOKEN_SOURCE, 'g');

  let match = pattern.exec(source);
  while (match !== null) {
    const [, level, environment] = match;
    if (level) {
      const headingEnd = skipHeadingArgument(source, pattern.lastIndex);
      if (headingEnd !== -1) {
        // Advance the counter even for an unlabelled heading: it still
        // occupies a number, and the ones after it must not shift up.
        const number = numberForHeading(level, sectionNumber, counters);
        const label = readTrailingLabel(source, headingEnd);
        if (label) found.push({ label, kind: level, number });
        pattern.lastIndex = headingEnd;
      }
    } else if (NUMBERED_MATH_ENVIRONMENTS.has(environment)) {
      const end = findEndEnvironment(source, pattern.lastIndex, environment);
      if (end !== -1) {
        const bodyEnd = end - `\\end{${environment}}`.length;
        const body = source.slice(pattern.lastIndex, bodyEnd);
        for (const label of readEquationLabels(body)) {
          counters.equation += 1;
          found.push({
            label, kind: 'equation', number: `${sectionNumber}.${counters.equation}`,
          });
        }
        pattern.lastIndex = end;
      }
    }
    match = pattern.exec(source);
  }
  return found;
}

/**
 * Index every chapter's sections and equations into one reference dict.
 *
 * Later chapters never overwrite earlier ones on a duplicate label — the
 * first definition wins, matching LaTeX's "label defined twice" behaviour
 * of keeping the first.
 */
export function buildDocumentReferences(
  chapters: ChapterSource[],
): DocumentReferenceIndex {
  const references: Record<string, ReferenceTarget> = {};
  const chapterByLabel: Record<string, string> = {};
  for (const chapter of chapters) {
    if (!chapter.source) continue;
    for (const entry of scanDocumentLabels(chapter.source, chapter.sectionNumber)) {
      if (entry.label in references) continue;
      references[entry.label] = { kind: entry.kind, number: entry.number };
      chapterByLabel[entry.label] = chapter.path;
    }
  }
  return { references, chapterByLabel };
}
