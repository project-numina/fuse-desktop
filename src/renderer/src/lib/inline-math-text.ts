import type { MacroDict } from '@/lib/latex-macros';
import { renderMath } from '@/lib/render-math';
import {
  findMatchingBrace,
  readCommandName,
  skipOptionalWhitespace,
} from '@/lib/render-math/scan-helpers';
import { ESCAPED_CHARS, FORMATTING_COMMANDS } from '@/lib/render-math/tables';

const LITERAL_BACKSLASH_SENTINEL = '\u{F0000}';

interface InlineMathSegment {
  text: string;
  math: boolean;
}

interface InlineMathRange {
  close: number;
  delimiterLength: number;
}

interface ProtectedSequence {
  text: string;
  next: number;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findDollarClose(text: string, open: number): number | null {
  for (let cursor = open + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] !== '$' || isEscaped(text, cursor)) continue;

    const closesAfterWhitespace = /\s/.test(text[cursor - 1] ?? '');
    const looksLikePairedCurrency = /\d/.test(text[open + 1] ?? '')
      && /\d/.test(text[cursor + 1] ?? '');
    if (cursor === open + 1 || closesAfterWhitespace || looksLikePairedCurrency) return null;
    return cursor;
  }
  return null;
}

function findParenthesisClose(text: string, open: number): number | null {
  for (let cursor = open + 2; cursor < text.length - 1; cursor += 1) {
    if (text[cursor] === '\\' && text[cursor + 1] === ')' && !isEscaped(text, cursor)) {
      return cursor;
    }
  }
  return null;
}

function inlineMathAt(text: string, cursor: number): InlineMathRange | null {
  if (
    text[cursor] === '$'
    && text[cursor + 1] !== '$'
    && !/\s/.test(text[cursor + 1] ?? '')
    && !isEscaped(text, cursor)
  ) {
    const close = findDollarClose(text, cursor);
    return close === null ? null : { close, delimiterLength: 1 };
  }
  if (
    text[cursor] === '\\'
    && text[cursor + 1] === '('
    && !isEscaped(text, cursor)
  ) {
    const close = findParenthesisClose(text, cursor);
    return close === null ? null : { close, delimiterLength: 2 };
  }
  return null;
}

function splitInlineMath(text: string): InlineMathSegment[] {
  const segments: InlineMathSegment[] = [];
  let plainStart = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const math = inlineMathAt(text, cursor);
    if (!math) {
      cursor += 1;
      continue;
    }

    if (plainStart < cursor) {
      segments.push({ text: text.slice(plainStart, cursor), math: false });
    }
    segments.push({
      text: text.slice(cursor + math.delimiterLength, math.close),
      math: true,
    });
    cursor = math.close + math.delimiterLength;
    plainStart = cursor;
  }

  if (plainStart < text.length) {
    segments.push({ text: text.slice(plainStart), math: false });
  }
  return segments;
}

function protectBackslashSequence(text: string, cursor: number): ProtectedSequence {
  const nextCharacter = text[cursor + 1];
  if (nextCharacter && ESCAPED_CHARS.includes(nextCharacter)) {
    return { text: text.slice(cursor, cursor + 2), next: cursor + 2 };
  }

  const [commandName, afterCommand] = readCommandName(text, cursor + 1);
  const argumentOpen = skipOptionalWhitespace(text, afterCommand);
  if (FORMATTING_COMMANDS[commandName] && text[argumentOpen] === '{') {
    const argumentClose = findMatchingBrace(text, argumentOpen);
    if (argumentClose !== -1) {
      const argument = text.slice(argumentOpen + 1, argumentClose);
      return {
        text: `\\${commandName}{${protectPlainText(argument)}}`,
        next: argumentClose + 1,
      };
    }
  }

  return { text: LITERAL_BACKSLASH_SENTINEL, next: cursor + 1 };
}

function protectPlainText(text: string): string {
  const protectedText: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const math = inlineMathAt(text, cursor);
    if (math) {
      protectedText.push(text.slice(cursor, math.close + math.delimiterLength));
      cursor = math.close + math.delimiterLength;
      continue;
    }

    if (text[cursor] === '\\') {
      const sequence = protectBackslashSequence(text, cursor);
      protectedText.push(sequence.text);
      cursor = sequence.next;
      continue;
    }

    const character = text[cursor];
    protectedText.push(ESCAPED_CHARS.includes(character) ? `\\${character}` : character);
    cursor += 1;
  }

  return protectedText.join('');
}

/**
 * Renders inline math while treating everything outside valid delimiters as
 * literal user-entered text. This keeps free-form titles from acquiring LaTeX
 * comment, command, or grouping semantics.
 */
export function renderInlineMathText(text: string, macros?: MacroDict): string {
  const html = renderMath(protectPlainText(text), macros);
  return html.replaceAll(LITERAL_BACKSLASH_SENTINEL, '&#92;');
}

/** Removes recognized inline-math delimiters for plain-text surfaces such as browser tabs. */
export function stripInlineMathDelimiters(text: string): string {
  return splitInlineMath(text).map((segment) => segment.text).join('');
}
