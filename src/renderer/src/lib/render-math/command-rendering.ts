import {
  FORMATTING_COMMANDS,
  REFERENCE_COMMANDS,
  SECTIONING_COMMANDS,
  SPACING_MAP,
  STRIP_COMMANDS,
} from './tables';
import {
  escapeAttribute,
  escapeHtml,
  extractBraceArg,
  findMatchingBrace,
  isSafeUrl,
  readCommandName,
  readInlineCode,
  readTrailingLabel,
  renderKatex,
  skipOptionalWhitespace,
} from './scan-helpers';
import { handleBeginEnvironment } from './environment-rendering';
import {
  documentAnchorId,
  escapeRenderAttribute,
  renderReferenceLink,
} from './reference-rendering';
import type { RecursiveRenderer, RenderContext } from './render-types';

interface CommandRequest {
  input: string;
  commandName: string;
  pos: number;
  out: string[];
  depth: number;
  context: RenderContext;
  scan: RecursiveRenderer;
}

export function dispatchCommand(request: CommandRequest): number {
  const { commandName, input, pos, out, depth, context, scan } = request;
  if (commandName === 'begin') {
    return handleBeginEnvironment(input, pos, out, depth, context, scan);
  }
  if (commandName in SPACING_MAP) {
    out.push(SPACING_MAP[commandName]);
    return skipOptionalWhitespace(input, pos);
  }
  if (commandName in FORMATTING_COMMANDS) return renderFormatting(request);
  if (commandName in SECTIONING_COMMANDS) return renderSection(request);
  if (REFERENCE_COMMANDS.has(commandName)) return renderReference(request);
  const inlineCode = readInlineCode(input, pos, commandName);
  if (inlineCode) {
    out.push(`<code>${escapeHtml(inlineCode.content)}</code>`);
    return inlineCode.afterClose;
  }
  if (commandName === 'href') return renderHref(request);
  if (commandName === 'url') return renderUrl(request);
  if (STRIP_COMMANDS.has(commandName)) return stripCommand(request);
  if (commandName in context.macros) return renderMacro(request);
  return renderUnknownCommand(request);
}

function renderFormatting(request: CommandRequest): number {
  const { input, pos, commandName, out, depth, context, scan } = request;
  const argument = extractBraceArg(input, pos);
  if (!argument) return pos;
  const tag = FORMATTING_COMMANDS[commandName];
  const inner = scan(argument.content, depth + 1, context);
  out.push(`<${tag}>${inner}</${tag}>`);
  return argument.afterClose;
}

function renderSection(request: CommandRequest): number {
  const { input, pos, commandName, out, depth, context, scan } = request;
  const cursor = skipSectionShortTitle(input, pos);
  const argument = extractBraceArg(input, cursor);
  if (!argument) return pos;
  const tag = SECTIONING_COMMANDS[commandName];
  const inner = scan(argument.content, depth + 1, context);
  const label = readTrailingLabel(input, argument.afterClose);
  const anchor = label
    ? ` id="${escapeRenderAttribute(documentAnchorId(commandName, label))}"`
      + ` data-doc-anchor="${escapeRenderAttribute(label)}"`
    : '';
  out.push(`<${tag} class="doc-${commandName}"${anchor}>${inner}</${tag}>`);
  return argument.afterClose;
}

function skipSectionShortTitle(input: string, pos: number): number {
  const cursor = skipOptionalWhitespace(input, pos);
  if (input[cursor] !== '[') return cursor;
  const close = input.indexOf(']', cursor);
  return close === -1 ? cursor : close + 1;
}

function renderReference(request: CommandRequest): number {
  const { input, pos, commandName, out, context } = request;
  const argument = extractBraceArg(input, pos);
  if (!argument) return pos;
  const label = argument.content.trim();
  const resolved = context.references[label];
  if (resolved && typeof resolved === 'object') {
    out.push(renderReferenceLink(commandName, label, resolved));
  } else {
    out.push(escapeHtml(typeof resolved === 'string' ? resolved : argument.content));
  }
  return argument.afterClose;
}

function renderHref(request: CommandRequest): number {
  const { input, pos, out, depth, context, scan } = request;
  const urlArg = extractBraceArg(input, pos);
  if (!urlArg) return pos;
  const textArg = extractBraceArg(input, urlArg.afterClose);
  if (!textArg) return urlArg.afterClose;
  const url = urlArg.content.trim();
  const inner = scan(textArg.content, depth + 1, context);
  if (isSafeUrl(url)) {
    out.push(
      `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">`
      + `${inner}</a>`,
    );
  } else {
    out.push(inner);
  }
  return textArg.afterClose;
}

function renderUrl(request: CommandRequest): number {
  const { input, pos, out } = request;
  const argument = extractBraceArg(input, pos);
  if (!argument) return pos;
  const url = argument.content.trim();
  if (isSafeUrl(url)) {
    out.push(
      `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">`
      + `${escapeHtml(url)}</a>`,
    );
  } else {
    out.push(escapeHtml(url));
  }
  return argument.afterClose;
}

function stripCommand(request: CommandRequest): number {
  const argument = extractBraceArg(request.input, request.pos);
  return argument ? argument.afterClose : request.pos;
}

function renderMacro(request: CommandRequest): number {
  const { input, pos, commandName, out, context } = request;
  const [suffixes, afterSuffixes] = readMathSuffixes(input, pos);
  out.push(renderKatex(
    `\\${commandName}${suffixes}`,
    false,
    context.macros,
    context.references,
  ));
  return afterSuffixes;
}

function renderUnknownCommand(request: CommandRequest): number {
  const { input, pos, out, depth, context, scan } = request;
  const argument = extractBraceArg(input, pos);
  if (!argument) return skipOptionalWhitespace(input, pos);
  out.push(scan(argument.content, depth + 1, context));
  return argument.afterClose;
}

function readMathSuffixes(input: string, pos: number): [string, number] {
  let suffixes = '';
  let index = pos;
  while (input[index] === '_' || input[index] === '^') {
    const [token, after] = readMathSubSuper(input, index);
    if (!token) break;
    suffixes += token;
    index = after;
  }
  return [suffixes, index];
}

function readMathSubSuper(input: string, pos: number): [string, number] {
  const marker = input[pos];
  if (marker !== '_' && marker !== '^') return ['', pos];
  const next = input[pos + 1];
  if (next === undefined) return ['', pos];
  if (next === '{') {
    const close = findMatchingBrace(input, pos + 1);
    return close === -1 ? ['', pos] : [input.slice(pos, close + 1), close + 1];
  }
  if (next === '\\') {
    const [, after] = readCommandName(input, pos + 2);
    return after === pos + 2 ? ['', pos] : [input.slice(pos, after), after];
  }
  return [input.slice(pos, pos + 2), pos + 2];
}
