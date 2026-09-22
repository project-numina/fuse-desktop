/**
 * Macro and chapter-heading extraction for contained LaTeX projects.
 *
 * Macros feed the renderer's KaTeX setup; chapter titles and labels feed the
 * chapter navigation and `\ref` numbering. Everything here is a small
 * hand-written scanner over comment-stripped text.
 */

import * as path from 'node:path';
import { expandLatexIncludes, memoizedReader, readUtf8, resolveProjectPath, type TextReader } from './project';

const COMMAND_KEYWORD = /\\(?:new|provide|renew)command\b/g;
const MATH_OPERATOR_KEYWORD = /\\DeclareMathOperator(\*?)/g;
const COMMAND_NAME = /\\([a-zA-Z]+)/y;
const ENSUREMATH_WRAPPER = /^\s*\\ensuremath\s*\{/;
const CHAPTER_KEYWORD = /\\chapter\b\*?/;
const SECTION_KEYWORD = /\\section\b\*?/;

// Python's `str.splitlines()` boundaries: this scanner (unlike the offset
// preserving parser) does split on the extra Unicode separators, and a
// trailing empty line is dropped. The control characters are deliberate.
// eslint-disable-next-line no-control-regex
const SPLITLINES_PATTERN = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;

function splitLines(text: string): string[] {
  const lines = text.split(SPLITLINES_PATTERN);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Remove comments while respecting escaped percent characters. */
function stripLatexComments(text: string): string {
  const cleaned: string[] = [];
  for (const line of splitLines(text)) {
    let index = 0;
    while (index < line.length) {
      if (line[index] === '\\' && index + 1 < line.length) index += 2;
      else if (line[index] === '%') break;
      else index += 1;
    }
    cleaned.push(line.slice(0, index));
  }
  return cleaned.join('\n');
}

function skipWhitespace(text: string, position: number): number {
  while (position < text.length && ' \t\r\n'.includes(text[position])) position += 1;
  return position;
}

/** Read a balanced brace group; `[null, position]` when malformed or unterminated. */
export function readBraceGroup(text: string, position: number): [string | null, number] {
  if (position >= text.length || text[position] !== '{') return [null, position];
  let depth = 1;
  const start = position + 1;
  let index = start;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      index += 2;
      continue;
    }
    if (text[index] === '{') {
      depth += 1;
    } else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return [text.slice(start, index), index + 1];
    }
    index += 1;
  }
  return [null, position];
}

/** Read the `\name` (braced or bare) that a definition targets. */
export function readCommandTarget(text: string, position: number): [string | null, number] {
  if (position >= text.length) return [null, position];
  if (text[position] === '{') {
    const [inner, after] = readBraceGroup(text, position);
    if (inner === null) return [null, after];
    const match = /^\\([a-zA-Z]+)/.exec(inner.trim());
    return match !== null ? [match[1], after] : [null, after];
  }
  if (text[position] === '\\') {
    const pattern = new RegExp(COMMAND_NAME.source, 'y');
    pattern.lastIndex = position;
    const match = pattern.exec(text);
    return match !== null ? [match[1], match.index + match[0].length] : [null, position];
  }
  return [null, position];
}

/** Unwrap a body that is exactly `\ensuremath{...}` (nothing but whitespace around). */
function normalizeBody(body: string): string {
  const trimmed = body.trim();
  const match = ENSUREMATH_WRAPPER.exec(trimmed);
  if (match === null) return body;
  const [inner, after] = readBraceGroup(trimmed, match[0].length - 1);
  if (inner === null || trimmed.slice(after).trim()) return body;
  return inner;
}

function parseNewcommandPass(source: string, macros: Record<string, string>): void {
  const keyword = new RegExp(COMMAND_KEYWORD.source, 'g');
  let position = 0;
  for (;;) {
    keyword.lastIndex = position;
    const match = keyword.exec(source);
    if (match === null) break;
    position = skipWhitespace(source, match.index + match[0].length);
    const [name, afterName] = readCommandTarget(source, position);
    position = afterName;
    if (name === null) continue;
    position = skipWhitespace(source, position);
    let hasArguments = false;
    while (position < source.length && source[position] === '[') {
      const close = source.indexOf(']', position);
      if (close === -1) break;
      hasArguments = true;
      position = skipWhitespace(source, close + 1);
    }
    const [body, afterBody] = readBraceGroup(source, position);
    position = afterBody;
    if (body !== null && !hasArguments && !(match[0] === '\\providecommand' && Object.hasOwn(macros, name))) {
      macros[name] = normalizeBody(body);
    }
  }
}

function parseMathOperatorPass(source: string, macros: Record<string, string>): void {
  const keyword = new RegExp(MATH_OPERATOR_KEYWORD.source, 'g');
  let position = 0;
  for (;;) {
    keyword.lastIndex = position;
    const match = keyword.exec(source);
    if (match === null) break;
    position = skipWhitespace(source, match.index + match[0].length);
    const [name, afterName] = readCommandTarget(source, position);
    position = afterName;
    if (name === null) continue;
    const [label, afterLabel] = readBraceGroup(source, skipWhitespace(source, position));
    position = afterLabel;
    if (label !== null) {
      const operator = match[1] ? '\\operatorname*' : '\\operatorname';
      macros[name] = `${operator}{${label}}`;
    }
  }
}

/**
 * Extract no-argument command definitions and declared math operators.
 * Later definitions overwrite earlier ones (`\renewcommand` wins), while
 * `\providecommand` only fills undefined names. Macros
 * with an argument spec are skipped. Keys are names without the backslash.
 */
export function parseNewcommandDefinitions(text: string, existing: Record<string, string> = {}): Record<string, string> {
  const stripped = stripLatexComments(text);
  const macros: Record<string, string> = { ...existing };
  parseNewcommandPass(stripped, macros);
  parseMathOperatorPass(stripped, macros);
  return macros;
}

function readProjectSource(projectRoot: string, relative: string, reader: TextReader): string | null {
  const resolved = resolveProjectPath(projectRoot, relative);
  if (resolved === null) return null;
  try {
    return reader(resolved);
  } catch {
    return null;
  }
}

/** Load conventional macro locations and contained includes in document order. */
export function loadBlueprintMacros(
  projectRoot: string,
  blueprintFilePath: string,
  reader: TextReader = readUtf8,
): Record<string, string> {
  // Repo-relative entrypoints always use '/' separators.
  const directory = path.posix.dirname(blueprintFilePath);
  const prefix = directory === '' || directory === '.' ? '' : `${directory}/`;
  const candidates = [
    `${prefix}macros/common.tex`,
    `${prefix}macro/common.tex`,
    `${prefix}macros/web.tex`,
    `${prefix}macro/web.tex`,
    `${prefix}web.tex`,
    `${prefix}print.tex`,
    blueprintFilePath,
  ];
  let result: Record<string, string> = {};
  const cachedReader = memoizedReader(reader);
  for (const candidate of candidates) {
    const absolute = resolveProjectPath(projectRoot, candidate);
    if (!absolute) continue;
    const source = expandLatexIncludes(absolute, projectRoot, {
      reader: cachedReader,
      inputSearchRoots: [path.dirname(absolute)],
    });
    if (source) result = parseNewcommandDefinitions(source, result);
  }
  return result;
}

/** A chapter title, or a section title if no chapter is present. */
export function extractChapterTitle(text: string): string | null {
  const source = stripLatexComments(text);
  const match = CHAPTER_KEYWORD.exec(source) ?? SECTION_KEYWORD.exec(source);
  if (match === null) return null;
  const [content] = readBraceGroup(source, skipWhitespace(source, match.index + match[0].length));
  return content !== null ? content.trim() : null;
}

/** Map contained chapter paths to their heading titles. */
export function loadChapterTitles(
  projectRoot: string,
  chapterPaths: readonly string[],
  reader: TextReader = readUtf8,
): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const chapterPath of chapterPaths) {
    const source = readProjectSource(projectRoot, chapterPath, reader);
    if (!source) continue;
    const title = extractChapterTitle(source);
    if (title) titles[chapterPath] = title;
  }
  return titles;
}

/** A label immediately following a `\chapter` heading (never `\section`). */
export function extractChapterLabel(text: string): string | null {
  const source = stripLatexComments(text);
  const match = CHAPTER_KEYWORD.exec(source);
  if (match === null) return null;
  const titleStart = skipWhitespace(source, match.index + match[0].length);
  const [, afterTitle] = readBraceGroup(source, titleStart);
  if (afterTitle === titleStart) return null;
  const cursor = skipWhitespace(source, afterTitle);
  if (!source.startsWith('\\label', cursor)) return null;
  const [label] = readBraceGroup(source, skipWhitespace(source, cursor + 6));
  return label !== null ? label.trim() : null;
}

/** Number chapter labels 1..N in the supplied chapter-file order (files without a heading are not counted). */
export function loadChapterReferences(
  projectRoot: string,
  chapterPaths: readonly string[],
  reader: TextReader = readUtf8,
): Record<string, string> {
  const references: Record<string, string> = {};
  let number = 0;
  for (const chapterPath of chapterPaths) {
    const source = readProjectSource(projectRoot, chapterPath, reader);
    if (!source || extractChapterTitle(source) === null) continue;
    number += 1;
    const label = extractChapterLabel(source);
    if (label) references[label] = String(number);
  }
  return references;
}
