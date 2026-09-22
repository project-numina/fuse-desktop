/**
 * Parse a blueprint's LaTeX source from the repository folder into the
 * normalized shape the model store consumes (`ParsedBlueprintSource`).
 *
 * Each included file is parsed independently so declarations carry the
 * repo-relative path of the chapter they came from; cross-file `\proves`
 * proofs are stitched after every file has been parsed. Reading is pure and
 * synchronous; the only output is data for `applyParserRefresh`.
 */

import { maskLatexComments } from './latex/comments';
import { parseBlueprintLatex, type BlueprintDeclaration, type UnattachedProof, deriveLeanokStatus } from './latex/blueprint';
import { collectIncludedFiles, expandLatexIncludes, memoizedReader, projectRelativePath, resolvesUnder, type TextReader } from './latex/project';
import { universalNewlines } from './lean-files';
import type { BlueprintModel, ParsedBlueprintSource, ParsedDeclaration } from './model';
import { applyParserRefresh } from './model';
import { clonePathOf, resolveExistingEntrypoint, resolveProjectBlueprintEntrypoint } from './paths';
import { dirname, resolve } from 'node:path';
import { statSync } from 'node:fs';

/**
 * The parser accepts anything in `\label{...}` up to the closing brace, which
 * is too permissive for a stored identifier (a malicious .tex could supply
 * `../escape`). Allowlist a safe subset.
 */
const VALID_LABEL = /^[A-Za-z0-9][A-Za-z0-9.:_-]*$/;

export function isSafeLabel(label: string): boolean {
  if (!label || label.includes('..')) return false;
  if (label.includes('/') || label.includes('\\') || label.includes('\0')) return false;
  return VALID_LABEL.test(label);
}

const LABEL_PATTERN = /\\label\{([^}]+)\}/g;

/** Mutable per-file declaration used while cross-file proofs are attached. */
interface LatexEntry {
  kind: string;
  label: string;
  title: string;
  statement: string;
  proof: string | null;
  leanName: string;
  leanFile: string;
  uses: string[];
  statementLeanok: boolean;
  proofLeanok: boolean;
  /** Other repository-relative file holding a cross-file `\proves` proof. */
  proofSourceFile: string;
}

function entryFromShared(declaration: BlueprintDeclaration): LatexEntry {
  return {
    kind: declaration.kind,
    label: declaration.label,
    title: declaration.title,
    statement: declaration.statement,
    proof: declaration.proof,
    leanName: declaration.leanName,
    leanFile: declaration.leanFile,
    uses: [...declaration.uses],
    statementLeanok: declaration.statementLeanok,
    proofLeanok: declaration.proofLeanok,
    proofSourceFile: '',
  };
}

function entryStatus(entry: LatexEntry): string {
  return deriveLeanokStatus(entry.kind, entry.proof !== null, entry.statementLeanok, entry.proofLeanok);
}

/** Read the entrypoint with `\input`/`\include` expanded, the entrypoint directory being TeX's cwd. */
function readExpandedLatexSource(texFile: string, cloneRoot: string, reader?: TextReader): string | null {
  return expandLatexIncludes(texFile, cloneRoot, { inputSearchRoots: [dirname(texFile)], reader });
}

/** The include chain plus the targets it could not read. */
export interface BlueprintIncludeChain {
  /** Entrypoint first, then the `\input` chain in pre-order. */
  includedFiles: string[];
  /** Contained include targets that are not readable files, in first-seen order. */
  missingIncludes: string[];
}

/**
 * Walk `\input` / `\include` once and return the repo-relative files it
 * read (entrypoint first, each at most once; cycles skipped) together with
 * the contained targets it could not read — the chapter an agent has
 * `\input` but not written yet, or one that was deleted. Those are not part
 * of the blueprint, but the file watcher needs them so their creation
 * triggers a re-parse.
 */
export function collectBlueprintIncludeChain(texFile: string, cloneRoot: string, reader?: TextReader): BlueprintIncludeChain {
  const candidates: string[] = [];
  const includedFiles = collectIncludedFiles(texFile, cloneRoot, {
    inputSearchRoots: [dirname(texFile)],
    reader,
    onInput: (_current, _line, _rawTarget, child) => {
      if (child !== null) candidates.push(child);
    },
  });
  const included = new Set(includedFiles);
  const missingIncludes: string[] = [];
  for (const candidate of candidates) {
    const relative = projectRelativePath(cloneRoot, candidate);
    if (relative === null || included.has(relative) || missingIncludes.includes(relative)) continue;
    missingIncludes.push(relative);
  }
  return { includedFiles, missingIncludes };
}

/**
 * Walk `\input` / `\include` and return repo-relative file paths, entrypoint
 * first, each at most once; cycles and missing files are skipped.
 */
export function collectBlueprintIncludedFiles(texFile: string, cloneRoot: string): string[] {
  return collectIncludedFiles(texFile, cloneRoot, { inputSearchRoots: [dirname(texFile)] });
}

/**
 * Attach each cross-file `\proves` proof to its declaration, in place.
 *
 * Files are parsed one at a time, so a proof written in an appendix cannot
 * see a statement declared in another chapter. Once every file has been
 * parsed the link resolves here: the proof is attached, its `\leanok`
 * re-derives the declaration's status, and `proofSourceFile` records where
 * the proof lives so the `.tex` write side marks the right file.
 *
 * A declaration that already has a proof keeps it (the proof written with
 * the statement wins, as in the single-file rules), and a target that exists
 * in no file at all is logged and dropped.
 */
function attachCrossFileProofs(
  entries: Array<[LatexEntry, string]>,
  unattached: Array<[UnattachedProof, string]>,
  blueprintName: string,
): void {
  // First declaration wins a duplicated label, matching the single-file rule.
  const byLabel = new Map<string, LatexEntry>();
  for (const [entry] of entries) if (!byLabel.has(entry.label)) byLabel.set(entry.label, entry);
  for (const [proof, proofSourceFile] of unattached) {
    const target = byLabel.get(proof.targetLabel);
    if (!target) {
      console.warn(`[blueprint] Blueprint ${blueprintName}: \\proves{${proof.targetLabel}} in ${proofSourceFile} names no declaration`);
      continue;
    }
    if (target.proof !== null) {
      console.warn(`[blueprint] Blueprint ${blueprintName}: ignoring \\proves{${proof.targetLabel}} in ${proofSourceFile}; the declaration already has a proof`);
      continue;
    }
    target.proof = proof.proof;
    target.proofLeanok = proof.proofLeanok;
    target.proofSourceFile = proofSourceFile;
  }
}

function entryToParsed(entry: LatexEntry, sourceFile: string): ParsedDeclaration {
  return {
    label: entry.label,
    kind: entry.kind,
    title: entry.title,
    statement: entry.statement,
    proof: entry.proof,
    uses: [...entry.uses],
    sourceFile,
    // A proof in the statement's own file needs no separate location.
    proofSourceFile: entry.proofSourceFile !== sourceFile ? entry.proofSourceFile : '',
    leanDeclaration: entry.leanName,
    leanFile: entry.leanFile,
    status: entryStatus(entry),
  };
}

/**
 * Read a blueprint's `.tex` from the repository folder and parse its
 * declarations. Returns null when the source file is missing, unreadable, or
 * escapes the folder. The entrypoint is resolved by existence, never by
 * falling back to the default write location: an undrafted workspace must not
 * parse a `blueprint/` the repo happens to ship.
 */
export function parseBlueprintSource(
  clonePath: string,
  blueprintName: string,
  blueprintFile: string | null = null,
  projectSubdir = '',
): ParsedBlueprintSource | null {
  const cloneRoot = resolve(clonePath);
  const entrypoint = resolveExistingEntrypoint(clonePath, blueprintName, blueprintFile, projectSubdir);
  if (entrypoint === null) return null;
  const texFile = clonePathOf(clonePath, entrypoint);
  if (!resolvesUnder(texFile, cloneRoot)) {
    console.warn(`[blueprint] Refusing metadata parse for ${blueprintName} because the source path resolves outside the clone`);
    return null;
  }
  try {
    if (!statSync(texFile).isFile()) return null;
  } catch {
    return null;
  }

  // One read per chapter: the include walk, the expansion and the per-file
  // parse below all go through the same memoized reader.
  const reader = memoizedReader();
  const { includedFiles, missingIncludes } = collectBlueprintIncludeChain(texFile, cloneRoot, reader);

  // Expanded source backs the label-presence check: a parse failure on
  // broken LaTeX must not delete a declaration whose label is still
  // textually present.
  const source = readExpandedLatexSource(texFile, cloneRoot, reader);
  if (source === null) return null;

  const entries: Array<[LatexEntry, string]> = [];
  const unattached: Array<[UnattachedProof, string]> = [];
  for (const repoRelativePath of includedFiles) {
    const includedFile = clonePathOf(clonePath, repoRelativePath);
    if (!resolvesUnder(includedFile, cloneRoot)) continue;
    // Python reads with universal newlines (CRLF → LF); an unreadable or
    // undecodable file is skipped rather than aborting the whole parse.
    const raw = reader(includedFile);
    if (raw === null) {
      console.warn(`[blueprint] Failed to read ${includedFile} while parsing blueprint ${blueprintName}`);
      continue;
    }
    const parsedFile = parseBlueprintLatex(universalNewlines(raw));
    for (const declaration of parsedFile.declarations) {
      if (!isSafeLabel(declaration.label)) {
        console.warn(`[blueprint] Skipping blueprint ${blueprintName} entry with unsafe label ${JSON.stringify(declaration.label)}`);
        continue;
      }
      entries.push([entryFromShared(declaration), repoRelativePath]);
    }
    for (const proof of parsedFile.unattachedProofs) unattached.push([proof, repoRelativePath]);
  }

  attachCrossFileProofs(entries, unattached, blueprintName);
  const declarations = entries.map(([entry, sourceFile]) => entryToParsed(entry, sourceFile));

  // Comments are masked so this agrees with the parser about what counts as
  // source: commenting a declaration out is a deliberate removal, so its
  // label must not hold the row open.
  const labelsInSource = new Set<string>();
  for (const match of maskLatexComments(source).matchAll(LABEL_PATTERN)) labelsInSource.add(match[1]);
  return { declarations, includedFiles, missingIncludes, labelsInSource };
}

/**
 * The selected Lean project's conventional blueprint entrypoint to persist,
 * or null. An explicitly stored source always wins, and a missing
 * conventional file leaves the manual source picker unchanged. The caller
 * stores the returned path on the blueprint row.
 */
export function adoptProjectBlueprint(clonePath: string, storedBlueprintFile: string | null, projectSubdir: string): string | null {
  if (storedBlueprintFile) return null;
  return resolveProjectBlueprintEntrypoint(clonePath, projectSubdir);
}

/**
 * Re-parse the folder's LaTeX and upsert declarations into the model. Returns
 * true when the source parsed, false when it was missing or unreadable (the
 * model is left untouched). The caller persists the model.
 */
export function refreshBlueprintModel(
  model: BlueprintModel,
  clonePath: string,
  blueprintName: string,
  blueprintFile: string | null,
  projectSubdir = '',
): boolean {
  const parsed = parseBlueprintSource(clonePath, blueprintName, blueprintFile, projectSubdir);
  if (parsed === null) return false;
  applyParserRefresh(model, parsed);
  return true;
}
