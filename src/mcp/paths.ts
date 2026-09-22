/**
 * Path and source helpers for the Lean tools.
 *
 * Agents pass file paths either absolute or relative to the Lean project
 * root (the web tools' convention, kept even though the desktop CLI itself
 * runs in the repository root). The app's `/lean/*` routes take paths
 * relative to the repository folder, so every tool normalises through
 * `toRepoRelativeLeanPath` first and refuses anything outside the project.
 *
 * The declaration scanner below is only the fallback range for
 * `lean_diagnostic_messages(declaration_name)`: the route resolves the name
 * through the LSP document symbols when the Lean service supports it.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FuseEnv } from './env';

function insideRoot(root: string, candidate: string): string | null {
  const rel = relative(root, candidate);
  if (rel === '') return '';
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

export function toPosix(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

/**
 * Repository-relative posix path for a Lean file the agent named. Mirrors the
 * web server's `_resolve_relative_path`: relative paths are project-relative,
 * absolute paths must stay inside the project.
 */
export function toRepoRelativeLeanPath(filePath: string, env: Pick<FuseEnv, 'repoPath' | 'projectRoot'>): string {
  const trimmed = filePath.trim();
  if (!trimmed) throw new Error('file_path must not be empty.');
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(env.projectRoot, trimmed);
  if (insideRoot(env.projectRoot, absolute) === null) {
    throw new Error(`File '${filePath}' is outside the assigned Lean project.`);
  }
  const repoRelative = insideRoot(env.repoPath, absolute);
  if (repoRelative === null || repoRelative === '') {
    throw new Error(`File '${filePath}' is outside the assigned Lean project.`);
  }
  return toPosix(repoRelative);
}

export interface DeclarationRange {
  /** 1-indexed, inclusive. */
  startLine: number;
  endLine: number;
}

interface DeclarationSite {
  qualified: string;
  line: number;
}

const DECLARATION_HEAD =
  /^(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|nonrec|unsafe|partial|scoped|local)\s+)*(?:theorem|lemma|def|abbrev|instance|structure|inductive|class|opaque|axiom)\b\s*(?:\(priority\s*:=[^)]*\)\s*)?([^\s:({[⦃⟨]+)?/u;
const NAMESPACE_LINE = /^namespace\s+([^\s]+)/;
const SECTION_LINE = /^section(?:\s+([^\s]+))?\s*$/;
const END_LINE = /^end(?:\s+([^\s]+))?\s*$/;
/** Column-0 lines that continue the current declaration rather than start a new command. */
const CONTINUATION_LINE = /^(?:\||termination_by\b|decreasing_by\b|where\b|deriving\b|--)/;
/** A column-0 block comment that is not a docstring (a docstring belongs to the next command). */
const BLOCK_COMMENT_OPEN = /^\/-(?!-)/;
const BLOCK_COMMENT_CLOSE = /-\//;

function segments(name: string): string[] {
  return name.split('.').filter((part) => part.length > 0);
}

function isStrictSuffix(candidate: string[], target: string[]): boolean {
  if (target.length === 0 || target.length >= candidate.length) return false;
  const offset = candidate.length - target.length;
  return target.every((segment, index) => candidate[offset + index] === segment);
}

interface Scope {
  kind: 'namespace' | 'section';
  name: string | null;
}

/** Every named declaration with its namespace-qualified name (1-indexed line). */
export function scanDeclarations(source: string): DeclarationSite[] {
  const lines = source.split(/\r?\n/);
  const scopes: Scope[] = [];
  const sites: DeclarationSite[] = [];
  let inBlockComment = false;
  lines.forEach((line, index) => {
    if (inBlockComment) {
      if (BLOCK_COMMENT_CLOSE.test(line)) inBlockComment = false;
      return;
    }
    if (BLOCK_COMMENT_OPEN.test(line)) {
      inBlockComment = !BLOCK_COMMENT_CLOSE.test(line.slice(2));
      return;
    }
    const namespaceMatch = NAMESPACE_LINE.exec(line);
    if (namespaceMatch) {
      scopes.push({ kind: 'namespace', name: namespaceMatch[1] });
      return;
    }
    const sectionMatch = SECTION_LINE.exec(line);
    if (sectionMatch) {
      scopes.push({ kind: 'section', name: sectionMatch[1] ?? null });
      return;
    }
    const endMatch = END_LINE.exec(line);
    if (endMatch) {
      // `end` closes the innermost scope when the names agree (an anonymous
      // `end` closes an anonymous section); a stray `end` changes nothing.
      const top = scopes[scopes.length - 1];
      if (top && top.name === (endMatch[1] ?? null)) scopes.pop();
      return;
    }
    const head = DECLARATION_HEAD.exec(line);
    if (!head || !head[1]) return;
    const namespaces = scopes.filter((scope): scope is Scope & { name: string } => scope.kind === 'namespace' && scope.name !== null).map((scope) => scope.name);
    sites.push({ qualified: [...namespaces, head[1]].join('.'), line: index + 1 });
  });
  return sites;
}

/**
 * Port of the web server's `_search_symbols`: an exact qualified match wins,
 * otherwise the target's dotted segments must be a strict trailing suffix of
 * exactly one declaration's qualified name; ambiguity refuses to guess.
 */
export function findDeclarationSite(sites: DeclarationSite[], target: string): DeclarationSite | null {
  const wanted = target.trim();
  if (!wanted) return null;
  const exact = sites.find((site) => site.qualified === wanted);
  if (exact) return exact;
  const wantedSegments = segments(wanted);
  const suffixMatches = sites.filter((site) => isStrictSuffix(segments(site.qualified), wantedSegments));
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

/**
 * Line range of a declaration in `source`, approximating the LSP document
 * symbol range from the text: the declaration runs from its header (plus
 * attribute lines directly above it) to the last non-blank, non-comment line
 * before the next column-0 command. Column-0 `--` lines and non-docstring
 * block comments never end a declaration.
 */
export function findDeclarationRange(source: string, declarationName: string): DeclarationRange | null {
  const site = findDeclarationSite(scanDeclarations(source), declarationName);
  if (!site) return null;
  const lines = source.split(/\r?\n/);
  let start = site.line;
  while (start > 1 && /^@\[/.test(lines[start - 2])) start -= 1;
  let end = lines.length;
  let inBlockComment = false;
  for (let index = site.line; index < lines.length; index += 1) {
    const line = lines[index];
    if (inBlockComment) {
      if (BLOCK_COMMENT_CLOSE.test(line)) inBlockComment = false;
      continue;
    }
    if (BLOCK_COMMENT_OPEN.test(line)) {
      inBlockComment = !BLOCK_COMMENT_CLOSE.test(line.slice(2));
      continue;
    }
    if (line.length === 0 || /^\s/.test(line) || CONTINUATION_LINE.test(line)) continue;
    end = index;
    break;
  }
  while (end > site.line && isBlankOrComment(lines[end - 1])) end -= 1;
  return { startLine: start, endLine: end };
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('--');
}
