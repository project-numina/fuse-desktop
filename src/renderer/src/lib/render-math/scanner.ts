import {
  ESCAPED_CHARS,
  FONT_GROUP_TAGS,
  MAX_DEPTH,
} from './tables';
import {
  escapeHtml,
  findClosingMathBraceAware,
  findClosingMathDisplay,
  findClosingMathInline,
  findMatchingBrace,
  flushText,
  readCommandName,
  renderKatex,
  skipOptionalWhitespace,
} from './scan-helpers';
import { dispatchCommand } from './command-rendering';
import type { RenderContext } from './render-types';

interface ScanState {
  input: string;
  depth: number;
  context: RenderContext;
  out: string[];
  text: string[];
  pos: number;
}

export function scanToHtml(
  input: string,
  depth: number,
  context: RenderContext,
): string {
  if (depth > MAX_DEPTH) return escapeHtml(input);
  const state: ScanState = {
    input,
    depth,
    context,
    out: [],
    text: [],
    pos: 0,
  };
  while (state.pos < input.length) scanNext(state);
  flushText(state.text, state.out);
  return state.out.join('');
}

function scanNext(state: ScanState): void {
  const character = state.input[state.pos];
  if (character === '$') {
    flushText(state.text, state.out);
    state.pos = handleDollar(state);
  } else if (character === '\\') {
    state.pos = handleBackslash(state);
  } else if (character === '%') {
    state.pos = skipLatexComment(state.input, state.pos);
  } else if (character === '{' || character === '}') {
    state.pos = handleBrace(state);
  } else if (character === '~') {
    flushText(state.text, state.out);
    state.out.push('&nbsp;');
    state.pos += 1;
  } else if (character === '\n') {
    state.pos = handleNewline(state);
  } else {
    state.text.push(character);
    state.pos += 1;
  }
}

function handleBrace(state: ScanState): number {
  const group = readFontGroup(state);
  if (!group) return state.pos + 1;
  flushText(state.text, state.out);
  state.out.push(group.html);
  return group.endPos;
}

function readFontGroup(state: ScanState): { html: string; endPos: number } | null {
  const { input, pos, depth, context } = state;
  if (input[pos] !== '{') return null;
  const cursor = skipOptionalWhitespace(input, pos + 1);
  if (input[cursor] !== '\\') return null;
  const [name, afterCommand] = readCommandName(input, cursor + 1);
  const tag = FONT_GROUP_TAGS[name];
  if (!tag) return null;
  const close = findMatchingBrace(input, pos);
  if (close === -1) return null;
  const body = input.slice(afterCommand, close).replace(/^[\s{]+/, '');
  const inner = scanToHtml(body, depth + 1, context);
  return { html: `<${tag}>${inner}</${tag}>`, endPos: close + 1 };
}

function skipLatexComment(input: string, pos: number): number {
  let index = pos + 1;
  while (index < input.length && input[index] !== '\n') index += 1;
  if (index < input.length) index += 1;
  while (input[index] === ' ' || input[index] === '\t') index += 1;
  return index;
}

function handleNewline(state: ScanState): number {
  const { input } = state;
  let index = state.pos;
  let newlineCount = 0;
  while (index < input.length) {
    const character = input[index];
    if (character === '\n') {
      newlineCount += 1;
      index += 1;
    } else if (character === ' ' || character === '\t' || character === '\r') {
      index += 1;
    } else {
      break;
    }
  }
  if (newlineCount >= 2) {
    flushText(state.text, state.out);
    state.out.push('<span class="paragraph-break"></span>');
  } else {
    state.text.push(' ');
  }
  return index;
}

function handleDollar(state: ScanState): number {
  const { input, pos, out, context } = state;
  const display = input[pos + 1] === '$';
  const start = pos + (display ? 2 : 1);
  const close = display
    ? findClosingMathDisplay(input, start)
    : findClosingMathInline(input, start);
  if (close === -1) {
    out.push(escapeHtml(display ? '$$' : '$'));
    return start;
  }
  out.push(renderKatex(
    input.slice(start, close),
    display,
    context.macros,
    context.references,
  ));
  return close + (display ? 2 : 1);
}

function handleBackslash(state: ScanState): number {
  const next = state.input[state.pos + 1];
  if (next === undefined) {
    state.text.push('\\');
    return state.pos + 1;
  }
  const simple = handleSimpleEscape(state, next);
  if (simple !== null) return simple;
  if (next === '(' || next === '[') return handleSlashMath(state, next);
  const [commandName, afterCommand] = readCommandName(state.input, state.pos + 1);
  if (!commandName) {
    state.text.push('\\');
    return state.pos + 1;
  }
  flushText(state.text, state.out);
  return dispatchCommand({
    input: state.input,
    commandName,
    pos: afterCommand,
    out: state.out,
    depth: state.depth,
    context: state.context,
    scan: scanToHtml,
  });
}

function handleSimpleEscape(state: ScanState, next: string): number | null {
  if (ESCAPED_CHARS.includes(next)) {
    state.text.push(next);
    return state.pos + 2;
  }
  const html = next === '\\'
    ? '<br>'
    : next === ',' ? '&thinsp;' : next === ';' ? '&MediumSpace;' : null;
  if (html === null) return null;
  flushText(state.text, state.out);
  state.out.push(html);
  return state.pos + 2;
}

function handleSlashMath(state: ScanState, next: string): number {
  flushText(state.text, state.out);
  const display = next === '[';
  const delimiter = display ? '\\]' : '\\)';
  const start = state.pos + 2;
  const close = findClosingMathBraceAware(state.input, start, delimiter);
  if (close === -1) {
    state.text.push(display ? '\\[' : '\\(');
    return start;
  }
  state.out.push(renderKatex(
    state.input.slice(start, close),
    display,
    state.context.macros,
    state.context.references,
  ));
  return close + 2;
}
