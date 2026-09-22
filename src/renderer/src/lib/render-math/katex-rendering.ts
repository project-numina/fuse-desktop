import katex from 'katex';
import 'katex/dist/katex.min.css';
import { sharedKatexOptions } from '@/lib/katex-config';
import { toKatexMacros, type MacroDict } from '@/lib/latex-macros';
import { REFERENCE_COMMANDS } from './tables';
import { readBraceArgument, readLatexCommand } from './scan-boundaries';
import { escapeHtmlValue } from './scan-primitives';
import { readVerbatimInline } from './scan-tokens';
import type { ReferenceDict } from './scan-helpers';

function escapeTexText(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, character => {
    if (character === '\\') return '\\textbackslash{}';
    if (character === '^') return '\\textasciicircum{}';
    if (character === '~') return '\\textasciitilde{}';
    return `\\${character}`;
  });
}

function renderReferenceText(
  command: string,
  label: string,
  references: ReferenceDict,
): string {
  const target = Object.hasOwn(references, label) ? references[label] : undefined;
  let text = typeof target === 'string' ? target : target?.number ?? label;
  if (command === 'eqref') text = `(${text})`;
  if (command === 'cref' && target && typeof target === 'object') {
    text = `${target.kind.charAt(0).toUpperCase()}${target.kind.slice(1)} ${text}`;
  }
  return `\\text{${escapeTexText(text)}}`;
}

function prepareMathCommand(
  input: string,
  pos: number,
  references: ReferenceDict,
): { text: string; after: number } {
  const [command, afterCommand] = readLatexCommand(input, pos + 1);
  if (!command) return { text: input.slice(pos, pos + 2), after: pos + 2 };
  const code = readVerbatimInline(input, afterCommand, command);
  if (code) {
    return { text: `\\texttt{${escapeTexText(code.content)}}`, after: code.afterClose };
  }
  if (REFERENCE_COMMANDS.has(command)) {
    const argument = readBraceArgument(input, afterCommand);
    if (argument) {
      return {
        text: renderReferenceText(command, argument.content.trim(), references),
        after: argument.afterClose,
      };
    }
  }
  return { text: input.slice(pos, afterCommand), after: afterCommand };
}

function prepareMathTex(input: string, references: ReferenceDict): string {
  let result = '';
  let pos = 0;
  while (pos < input.length) {
    if (input[pos] !== '\\') {
      result += input[pos];
      pos += 1;
      continue;
    }
    const command = prepareMathCommand(input, pos, references);
    result += command.text;
    pos = command.after;
  }
  return result;
}

/** Render TeX with document references resolved first, falling back to escaped source. */
export function renderPreparedKatex(
  tex: string,
  displayMode: boolean,
  macros: MacroDict,
  references: ReferenceDict = {},
): string {
  const trimmed = tex.trim();
  if (!trimmed) return '';
  try {
    const preparedMacros = Object.fromEntries(
      Object.entries(macros).map(([name, body]) => [
        name,
        prepareMathTex(body, references),
      ]),
    );
    return katex.renderToString(prepareMathTex(trimmed, references), {
      ...sharedKatexOptions,
      displayMode,
      macros: { '\\qedhere': '', ...toKatexMacros(preparedMacros) },
    });
  } catch {
    return displayMode
      ? `$$${escapeHtmlValue(trimmed)}$$`
      : `$${escapeHtmlValue(trimmed)}$`;
  }
}
