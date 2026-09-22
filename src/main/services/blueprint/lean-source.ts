/**
 * Read the Lean text a formalization review was actually looking at.
 *
 * The unit is one declaration, not one file: Lean files hold many
 * declarations, so a file-level fingerprint would retire every review in a
 * file whenever another declaration was formalized into it. The extraction
 * is textual and deliberately conservative — Lean is not parsed; headers are
 * matched with a regular expression. What matters is that it is
 * deterministic: the writer and the reader run the same function over the
 * same bytes. A name that matches no header, or more than one, yields ''.
 *
 * The proof body of a theorem/lemma/example is cut from the block because a
 * formalization review judges whether the Lean statement says what the
 * blueprint says; discharging a `sorry` afterwards does not change that. A
 * `def`'s body is kept: for a definition the body is the formalization.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolvesUnder } from './latex/project';

/** A top-level Lean declaration header, anchored at column 0. */
const DECLARATION_HEAD =
  /^(?:@\[[^\]\n]*\][ \t]*)*(?:(?:private|protected|noncomputable|public|partial|unsafe|nonrec|scoped|local)[ \t]+)*(theorem|lemma|example|def|abbrev|opaque|axiom|instance|structure|inductive|class)(?:[ \t]+([^\s:({[⦃⟨]+))?(?![\w'.])/u;

/** A column-0 line that ends a declaration block without starting another. */
const BLOCK_BOUNDARY =
  /^(?:end|namespace|section|open|import|universe|variable|variables|set_option|attribute|macro|macro_rules|syntax|notation|infix|infixl|infixr|prefix|postfix|declare_syntax_cat|deriving|initialize|run_cmd|#\w+)(?![\w'.])/u;

/** Kinds whose body after `:=` is a proof, and so is not part of the review. */
const PROOF_BODY_KINDS: ReadonlySet<string> = new Set(['theorem', 'lemma', 'example']);

const OPENING = '([{⟨⦃';
const CLOSING = ')]}⟩⦄';

/** A bare `sorry`, not the tail of a longer identifier. */
const SORRY_TOKEN = /(?<![\w'.])sorry(?![\w'])/gu;
const LINE_COMMENT = /--[^\n]*/g;
const BLOCK_COMMENT = /\/-[\s\S]*?-\//g;

/** One declaration's coordinates in the Lean project. */
export interface LeanSourceRef {
  /** The blueprint `\label{}` the Lean belongs to. */
  label: string;
  /** Lean-project-relative path, exactly as the declaration records it. */
  leanFile: string;
  /** The `\lean{}` value: one name, or several separated by commas. */
  leanDeclaration: string;
}

interface Block {
  kind: string;
  name: string | null;
  text: string;
}

/** Python `str.splitlines()` for the line terminators Lean files use. */
function splitLines(source: string): string[] {
  const lines = source.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '' && /[\r\n]$/.test(source)) lines.pop();
  return source === '' ? [] : lines;
}

/**
 * Split a Lean file into its top-level declaration blocks. Everything before
 * the first header, and between a boundary keyword and the next header,
 * belongs to no block and is dropped.
 */
function declarationBlocks(source: string): Block[] {
  const lines = splitLines(source);
  const starts: Array<[number, RegExpExecArray]> = [];
  const boundaries: number[] = [];
  lines.forEach((line, index) => {
    const match = DECLARATION_HEAD.exec(line);
    if (match) starts.push([index, match]);
    else if (BLOCK_BOUNDARY.test(line)) boundaries.push(index);
  });
  return starts.map(([index, match], position) => {
    const following = position + 1 < starts.length ? starts[position + 1][0] : lines.length;
    const end = Math.min(following, ...boundaries.filter((boundary) => boundary > index));
    return { kind: match[1], name: match[2] ?? null, text: lines.slice(index, end).join('\n') };
  });
}

/**
 * A declaration's header up to the `:=` that opens its body, found at
 * bracket depth zero so a default argument value or a structure instance in
 * the type is not mistaken for it. No top-level `:=` → the whole text.
 */
function statementOnly(text: string): string {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (OPENING.includes(character)) depth += 1;
    else if (CLOSING.includes(character)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && character === ':' && text.startsWith(':=', index)) return text.slice(0, index);
  }
  return text;
}

/** Whether a file's declared name is the one `\lean{}` asked for (exact, or namespace-qualified). */
function namesMatch(declared: string, wanted: string): boolean {
  return declared === wanted || wanted.endsWith(`.${declared}`);
}

/** Split a `\lean{}` value into its unique declaration names. */
function declarationNames(leanDeclaration: string): string[] {
  const names: string[] = [];
  for (const raw of leanDeclaration.split(',')) {
    const name = raw.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The Lean block declaring `leanDeclaration`, or '' when it was not found
 * unambiguously. For a theorem/lemma/example the block stops at the `:=`
 * that introduces the proof.
 */
export function declarationLeanSource(source: string, leanDeclaration: string): string {
  const wanted = leanDeclaration.trim();
  if (!wanted) return '';
  const matches = declarationBlocks(source).filter((block) => block.name !== null && namesMatch(block.name, wanted));
  if (matches.length !== 1) return '';
  const block = matches[0];
  const text = PROOF_BODY_KINDS.has(block.kind) ? statementOnly(block.text) : block.text;
  return text.trim();
}

/**
 * Each named top-level declaration's statement, by name. Anonymous
 * declarations are omitted, and a name declared twice is omitted as well.
 */
export function declarationStatements(source: string): Record<string, string> {
  const statements: Record<string, string> = {};
  const duplicated = new Set<string>();
  for (const block of declarationBlocks(source)) {
    if (block.name === null) continue;
    if (block.name in statements) {
      duplicated.add(block.name);
      continue;
    }
    const text = PROOF_BODY_KINDS.has(block.kind) ? statementOnly(block.text) : block.text;
    statements[block.name] = text.trim();
  }
  for (const name of duplicated) delete statements[name];
  return statements;
}

/** Strip Lean comments (block comments first so a `--` inside one is not a line comment). */
function withoutComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
}

/** How many `sorry` holes one Lean file's code contains, outside comments. */
export function leanSorryCount(source: string): number {
  return [...withoutComments(source).matchAll(SORRY_TOKEN)].length;
}

/** Read one Lean file from the project, or ''. Containment-checked: `leanFile` is agent-written metadata. */
function readProjectFile(projectRoot: string, relative: string): string {
  const candidate = join(projectRoot, ...relative.split('/'));
  if (!resolvesUnder(candidate, projectRoot)) {
    console.warn(`[blueprint] Refusing to read Lean source outside the project: ${relative}`);
    return '';
  }
  try {
    if (!statSync(candidate).isFile()) return '';
    return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(candidate));
  } catch {
    console.warn(`[blueprint] Could not read Lean source ${relative}`);
    return '';
  }
}

/**
 * Each reference's own Lean source, keyed by blueprint label. Every file is
 * read at most once; an unreadable file contributes an empty source rather
 * than throwing. A label is absent from the result exactly when its source
 * came back empty.
 */
export function readLeanSources(projectRoot: string | null, references: Iterable<LeanSourceRef>): Record<string, string> {
  const contents = new Map<string, string>();
  const sources: Record<string, string> = {};
  for (const reference of references) {
    const relative = reference.leanFile.trim();
    const names = declarationNames(reference.leanDeclaration);
    if (projectRoot === null || !relative || !names.length) continue;
    if (!contents.has(relative)) contents.set(relative, readProjectFile(projectRoot, relative));
    const text = contents.get(relative)!;
    if (!text) continue;
    const extracted = names.map((name) => declarationLeanSource(text, name)).join('\n').trim();
    if (extracted) sources[reference.label] = extracted;
  }
  return sources;
}
