import {
  readBraceArgument,
  readLatexCommand,
  skipWhitespace,
  type ParsedArgument,
} from './scan-boundaries';

interface ListScanState {
  body: string;
  items: string[];
  environmentDepth: number;
  currentStart: number;
  pos: number;
}

/** Split top-level list items without treating nested-environment items as siblings. */
export function splitListItems(body: string): string[] {
  const state: ListScanState = {
    body,
    items: [],
    environmentDepth: 0,
    currentStart: -1,
    pos: 0,
  };
  while (state.pos < body.length) {
    if (body[state.pos] !== '\\') {
      state.pos += 1;
      continue;
    }
    consumeListCommand(state);
  }
  if (state.currentStart !== -1) state.items.push(body.slice(state.currentStart));
  return state.items;
}

function consumeListCommand(state: ListScanState): void {
  const { body } = state;
  const [command, afterCommand] = readLatexCommand(body, state.pos + 1);
  if (command === 'begin' || command === 'end') {
    const environment = readBraceArgument(body, afterCommand);
    if (environment) {
      state.environmentDepth += command === 'begin' ? 1 : -1;
      state.environmentDepth = Math.max(0, state.environmentDepth);
      state.pos = environment.afterClose;
      return;
    }
  }
  if (isTopLevelItem(state, command, afterCommand)) {
    if (state.currentStart !== -1) {
      state.items.push(body.slice(state.currentStart, state.pos));
    }
    state.currentStart = skipItemLabel(body, afterCommand);
    state.pos = state.currentStart;
    return;
  }
  state.pos = afterCommand;
}

function isTopLevelItem(
  state: ListScanState,
  command: string,
  afterCommand: number,
): boolean {
  return command === 'item'
    && state.environmentDepth === 0
    && (afterCommand >= state.body.length || !/[a-zA-Z]/.test(state.body[afterCommand]));
}

function skipItemLabel(body: string, pos: number): number {
  const start = skipWhitespace(body, pos);
  if (body[start] !== '[') return pos;
  const close = body.indexOf(']', start);
  return close === -1 ? pos : close + 1;
}

export function readSectionLabel(input: string, pos: number): string {
  let index = pos;
  while (index < input.length) {
    if (/\s/.test(input[index])) index += 1;
    else if (input[index] === '%') {
      while (index < input.length && input[index] !== '\n') index += 1;
    } else break;
  }
  if (!input.startsWith('\\label', index)) return '';
  const argument = readBraceArgument(input, index + '\\label'.length);
  return argument ? argument.content.trim() : '';
}

export function removeLatexComments(source: string): string {
  return source.replace(/(^|[^\\])%[^\n]*/g, '$1');
}

export function readMathLabels(body: string): string[] {
  const labels: string[] = [];
  const pattern = /\\label\s*\{([^}]*)\}/g;
  const source = removeLatexComments(body);
  let match = pattern.exec(source);
  while (match !== null) {
    const label = match[1].trim();
    if (label) labels.push(label);
    match = pattern.exec(source);
  }
  return labels;
}

/** Read verbatim-style inline code without interpreting TeX within the payload. */
export function readVerbatimInline(
  input: string,
  pos: number,
  command: string,
): ParsedArgument | null {
  if (!['lstinline', 'mintinline', 'verb'].includes(command)) return null;
  let cursor = input[pos] === '*' ? pos + 1 : pos;
  cursor = skipWhitespace(input, cursor);
  if (command !== 'verb' && input[cursor] === '[') {
    const end = input.indexOf(']', cursor + 1);
    if (end === -1) return null;
    cursor = skipWhitespace(input, end + 1);
  }
  if (command === 'mintinline') {
    const language = readBraceArgument(input, cursor);
    if (!language) return null;
    cursor = skipWhitespace(input, language.afterClose);
  }
  if (input[cursor] === '{' && command !== 'verb') {
    return readBraceArgument(input, cursor);
  }
  return readDelimitedVerbatim(input, cursor);
}

function readDelimitedVerbatim(input: string, cursor: number): ParsedArgument | null {
  const delimiter = input[cursor];
  if (!delimiter || /[\w\s]/.test(delimiter)) return null;
  const end = input.indexOf(delimiter, cursor + 1);
  if (end === -1 || /[\r\n]/.test(input.slice(cursor + 1, end))) return null;
  return { content: input.slice(cursor + 1, end), afterClose: end + 1 };
}
