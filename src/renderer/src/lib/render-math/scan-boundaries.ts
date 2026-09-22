export interface ParsedArgument {
  content: string;
  afterClose: number;
}

export function skipWhitespace(input: string, pos: number): number {
  let index = pos;
  while (index < input.length && /[ \t\n\r]/.test(input[index])) index += 1;
  return index;
}

export function readLatexCommand(input: string, pos: number): [string, number] {
  let end = pos;
  while (end < input.length && /[a-zA-Z]/.test(input[end])) end += 1;
  return [input.slice(pos, end), end];
}

export function findBraceBoundary(input: string, pos: number): number {
  let depth = 1;
  let index = pos + 1;
  while (index < input.length) {
    const character = input[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

export function readBraceArgument(input: string, pos: number): ParsedArgument | null {
  const start = skipWhitespace(input, pos);
  if (input[start] !== '{') return null;
  const close = findBraceBoundary(input, start);
  if (close === -1) return null;
  return { content: input.slice(start + 1, close), afterClose: close + 1 };
}

/** Read a balanced optional argument, respecting escapes and brace-protected brackets. */
export function readOptionalArgument(input: string, pos: number): ParsedArgument | null {
  const start = skipWhitespace(input, pos);
  if (input[start] !== '[') return null;
  let depth = 1;
  let index = start + 1;
  while (index < input.length) {
    const character = input[index];
    if (character === '\\' && index + 1 < input.length) {
      index += 2;
      continue;
    }
    if (character === '{') {
      const close = findBraceBoundary(input, index);
      if (close === -1) return null;
      index = close + 1;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']' && --depth === 0) {
      return { content: input.slice(start + 1, index), afterClose: index + 1 };
    }
    index += 1;
  }
  return null;
}

export function findInlineMathBoundary(input: string, pos: number): number {
  let index = pos;
  while (index < input.length) {
    if (input[index] === '\\') index += 2;
    else if (input[index] === '$') return index;
    else index += 1;
  }
  return -1;
}

export function findDisplayMathBoundary(input: string, pos: number): number {
  let index = pos;
  while (index < input.length - 1) {
    if (input[index] === '$' && input[index + 1] === '$') return index;
    index += input[index] === '\\' ? 2 : 1;
  }
  return -1;
}

export function findEnvironmentBoundary(
  input: string,
  pos: number,
  envName: string,
): number {
  const beginTag = `\\begin{${envName}}`;
  const endTag = `\\end{${envName}}`;
  let depth = 1;
  let index = pos;
  while (index < input.length) {
    if (input.startsWith(beginTag, index)) {
      depth += 1;
      index += beginTag.length;
    } else if (input.startsWith(endTag, index)) {
      depth -= 1;
      if (depth === 0) return index + endTag.length;
      index += endTag.length;
    } else {
      index += 1;
    }
  }
  return -1;
}

/** Find a slash-delimited math closer while ignoring delimiters inside brace groups. */
export function findBraceAwareMathBoundary(
  input: string,
  pos: number,
  delimiter: string,
): number {
  let index = pos;
  while (index < input.length) {
    if (input[index] === '{') {
      const close = findBraceBoundary(input, index);
      if (close === -1) return -1;
      index = close + 1;
      continue;
    }
    if (input.startsWith(delimiter, index)) return index;
    index += input[index] === '\\' ? 2 : 1;
  }
  return -1;
}
