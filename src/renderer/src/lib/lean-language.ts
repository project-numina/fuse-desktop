/**
 * Lean 4 language support for CodeMirror 6 using StreamLanguage.
 * Provides keyword, comment, string, and number highlighting.
 */

import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';

const keywords = new Set([
  'abbrev', 'axiom', 'class', 'constant', 'def', 'deriving', 'do', 'else',
  'end', 'example', 'extends', 'fun', 'if', 'import', 'in', 'inductive',
  'infixl', 'infixr', 'instance', 'let', 'macro', 'match', 'mutual',
  'namespace', 'noncomputable', 'notation', 'open', 'opaque', 'partial',
  'prefix', 'prelude', 'private', 'protected', 'return', 'scoped', 'section',
  'set_option', 'structure', 'syntax', 'tactic', 'then', 'theorem', 'lemma',
  'universe', 'variable', 'where', 'with', 'by', 'have', 'show', 'from',
  'calc', 'suffices', 'sorry', 'Type', 'Prop', 'Sort',
]);

const builtins = new Set([
  'true', 'false', 'rfl', 'rw', 'simp', 'exact', 'apply', 'intro', 'intros',
  'cases', 'induction', 'constructor', 'assumption', 'contradiction', 'trivial',
  'ring', 'linarith', 'omega', 'norm_num', 'decide', 'aesop', 'tauto',
]);

const identifierStart = /^[a-zA-Zα-ωΑ-Ω_\u0370-\u03FF\u2100-\u214F]/;
const identifierContinue =
  /^[a-zA-Zα-ωΑ-Ω_\u0370-\u03FF\u2100-\u214F][a-zA-Zα-ωΑ-Ω0-9_'\u0370-\u03FF\u2100-\u214F]*/;
const operatorPattern =
  /^[+\-*/=<>≤≥≠∈∉⊂⊃∪∩∧∨¬→←↔⟨⟩λ∀∃:@|&!,.;(){}\[\]]+/;

interface LeanParserState {
  inBlockComment: number;
}

function tokenizeBlockComment(stream: StringStream, state: LeanParserState): string {
  if (stream.match('/-')) {
    state.inBlockComment++;
    return 'comment';
  }
  if (stream.match('-/')) {
    state.inBlockComment--;
    return 'comment';
  }
  stream.next();
  return 'comment';
}

function tokenizeString(stream: StringStream): string {
  while (!stream.eol()) {
    const character = stream.next();
    if (character === '\\') stream.next();
    else if (character === '"') break;
  }
  return 'string';
}

function tokenizeIdentifier(stream: StringStream): string {
  stream.match(identifierContinue);
  const word = stream.current();
  if (keywords.has(word)) return 'keyword';
  if (builtins.has(word)) return 'builtin';
  return 'variableName';
}

const leanMode: StreamParser<LeanParserState> = {
  startState() {
    return { inBlockComment: 0 };
  },

  token(stream: StringStream, state: LeanParserState): string | null {
    if (state.inBlockComment > 0) return tokenizeBlockComment(stream, state);
    if (stream.match('--')) { stream.skipToEnd(); return 'lineComment'; }
    if (stream.match('/-')) { state.inBlockComment = 1; return 'comment'; }
    if (stream.match('"')) return tokenizeString(stream);

    if (stream.match('\'') && stream.peek() !== ' ') {
      stream.next();
      if (stream.peek() === '\'') stream.next();
      return 'string';
    }

    if (stream.match(/^0[xX][0-9a-fA-F_]+/) || stream.match(/^\d[\d_]*/)) return 'number';
    if (stream.match(identifierStart)) return tokenizeIdentifier(stream);

    if (stream.match('#check') || stream.match('#eval')
      || stream.match('#print') || stream.match('#reduce')) {
      return 'meta';
    }

    if (stream.match(operatorPattern)) return 'operator';

    stream.next();
    return null;
  },
};

export function lean() {
  return StreamLanguage.define(leanMode);
}
