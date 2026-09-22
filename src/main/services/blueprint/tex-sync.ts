/**
 * `.tex` source synchronization for the `set_declaration_status` tool.
 *
 * The blueprint's LaTeX is a repository file, so a status change has to be
 * written into the source as well as the model. A multi-file blueprint keeps
 * its declarations in `\input`-ed chapters, which makes "rewrite the tag
 * block for these labels" a per-file operation: labels are grouped by the
 * file that defines them and each file is rewritten once. The `.tex` is
 * written before the model status is updated, and only labels whose source
 * was synced get their status stored — that ordering is what prevents the
 * two representations from drifting.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { formalizationIsTerminal } from './latex/blueprint';
import { maskLatexComments } from './latex/comments';
import { resolvesUnder } from './latex/project';
import { rewriteProofLeanokTags, rewriteTexTags, tagsFromDeclaration, type DeclarationTags } from './latex/tags';
import { collectBlueprintIncludedFiles } from './metadata';
import { declarationToJson, resolveDeclarationByLeanName, setDeclarationStatus, type BlueprintModel, type DeclarationRow } from './model';
import { clonePathOf, safeBlueprintFilePath } from './paths';

export const LABEL_IN_SOURCE = /\\label\{([^}]+)\}/g;

/**
 * Per-label inputs may arrive as a plain object or a Map (the service builds
 * Maps, typed loosely as `unknown` values). Tag values must be
 * `DeclarationTags` built by `tagsFromDeclaration` / `declarationTags`.
 */
export type LabelMap<T> = Record<string, T> | ReadonlyMap<string, T> | ReadonlyMap<string, unknown>;

function toRecord<T>(value: LabelMap<T>): Record<string, T> {
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, T>;
  return { ...(value as Record<string, T>) };
}

/** The stored status a tool-facing status name maps to, and whether the row must already carry a Lean name. */
export const STATUS_TARGETS: Readonly<Record<string, [status: string, requireFormalizationData: boolean]>> = Object.freeze({
  proved: ['proved', true],
  formalized: ['in_progress', true],
  unformalized: ['not_started', false],
});

/** Count `\label{}` commands in the source, ignoring commented-out ones. */
export function countLabelsInSource(source: string): number {
  return [...maskLatexComments(source).matchAll(/\\label\{[^}]*\}/g)].length;
}

/** Clone-relative path for messages, else the bare name. */
function relativeDisplay(clonePath: string, filePath: string): string {
  const rel = relative(resolve(clonePath), resolve(filePath)).split(sep).join('/');
  return rel && !rel.startsWith('..') ? rel : filePath.slice(filePath.lastIndexOf(sep) + 1);
}

/** An error message if `path` resolves outside the clone, else null. */
function pathContainmentError(clonePath: string, filePath: string, description: string): string | null {
  try {
    if (!resolvesUnder(filePath, clonePath)) return `Error: refusing to access ${description} outside the clone.`;
  } catch (error) {
    return `Error: could not resolve ${description}: ${String(error)}.`;
  }
  return null;
}

/** The entrypoint may be given absolute or repo-relative (the service passes the stored `blueprintFile`). */
function absoluteEntrypoint(clonePath: string, entrypoint: string): string {
  return isAbsolute(entrypoint) ? entrypoint : clonePathOf(clonePath, entrypoint);
}

/** Write `content` to `path` atomically via a sibling temp file. */
export function atomicWriteText(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

/**
 * Read a source file exactly as stored (CRLF and a BOM preserved) so the tag
 * rewriter can keep the file's newline style and byte prefix; null when
 * unreadable or not UTF-8.
 */
function readSourceExact(path: string): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  } catch {
    return null;
  }
}

/**
 * Map each `\label` to the repo-relative file that defines it, walking the
 * entrypoint's `\input` / `\include` chain and recording the first file each
 * label appears in. Used as a fallback when a declaration row carries no
 * `sourceFile`. Comments are masked, so a commented-out `\label` in one
 * chapter cannot claim a label that a later chapter really defines.
 */
export function labelSourceFiles(clonePath: string, entrypoint: string): Record<string, string> {
  const index: Record<string, string> = {};
  for (const relativePath of collectBlueprintIncludedFiles(absoluteEntrypoint(clonePath, entrypoint), clonePath)) {
    const source = readSourceExact(clonePathOf(clonePath, relativePath));
    if (source === null) continue;
    for (const match of maskLatexComments(source).matchAll(LABEL_IN_SOURCE)) {
      if (!(match[1] in index)) index[match[1]] = relativePath;
    }
  }
  return index;
}

/**
 * Resolve each pending label to the absolute `.tex` that defines it. A
 * stored `sourceFile` is trusted only after the same safe repo-relative
 * validation new rows get; an unusable value falls back to the include-chain
 * scan (run lazily), and only then to the entrypoint.
 */
function groupLabelsByFile(
  clonePath: string,
  entrypoint: string,
  pending: Record<string, DeclarationTags>,
  pendingSource: Record<string, string>,
  failures: string[],
): Map<string, string[]> {
  const safeSources = new Map<string, string | null>();
  for (const label of Object.keys(pending)) safeSources.set(label, safeBlueprintFilePath(pendingSource[label]));
  const includeIndex = [...safeSources.values()].some((value) => value === null) ? labelSourceFiles(clonePath, entrypoint) : {};

  const labelsByFile = new Map<string, string[]>();
  for (const label of Object.keys(pending)) {
    const sourceFile = safeSources.get(label) || includeIndex[label] || '';
    const filePath = sourceFile ? clonePathOf(clonePath, sourceFile) : entrypoint;
    const containment = pathContainmentError(clonePath, filePath, 'blueprint source');
    if (containment) {
      failures.push(`${label} (${containment})`);
      continue;
    }
    const bucket = labelsByFile.get(filePath) ?? [];
    bucket.push(label);
    labelsByFile.set(filePath, bucket);
  }
  return labelsByFile;
}

/** Rewrite one source file's tag blocks, returning the labels it synced. */
function rewriteOneFile(
  clonePath: string,
  filePath: string,
  fileLabels: string[],
  pending: Record<string, DeclarationTags>,
  failures: string[],
): string[] {
  const display = relativeDisplay(clonePath, filePath);
  const fileSource = readSourceExact(filePath);
  if (fileSource === null) {
    for (const label of fileLabels) failures.push(`${label} (failed to read ${display} for tag sync)`);
    return [];
  }
  const filePending = new Map<string, DeclarationTags>();
  for (const label of fileLabels) filePending.set(label, pending[label]);
  const { source: rewritten, matched } = rewriteTexTags(fileSource, filePending);
  for (const label of fileLabels) {
    if (!matched.has(label)) failures.push(`${label} (label not found in ${display}; refresh_blueprint_metadata or check the source)`);
  }
  const synced = fileLabels.filter((label) => matched.has(label));
  if (synced.length && rewritten !== fileSource) {
    try {
      atomicWriteText(filePath, rewritten);
    } catch (error) {
      // Leave these labels unsynced so their stored status stays put and
      // the next call re-runs cleanly.
      for (const label of synced) failures.push(`${label} (failed to write ${display}: ${String(error)})`);
      return [];
    }
  }
  return synced;
}

/** Rewrite one file's `\proves` proof markers, returning the labels synced. */
function rewriteOneProofFile(
  clonePath: string,
  filePath: string,
  fileLabels: string[],
  pending: Record<string, DeclarationTags>,
  failures: string[],
): string[] {
  const display = relativeDisplay(clonePath, filePath);
  const fileSource = readSourceExact(filePath);
  if (fileSource === null) {
    for (const label of fileLabels) failures.push(`${label} (failed to read ${display} for proof tag sync)`);
    return [];
  }
  const wanted = new Map<string, boolean>();
  for (const label of fileLabels) wanted.set(label, pending[label].proofLeanok);
  const { source: rewritten, matched } = rewriteProofLeanokTags(fileSource, wanted);
  for (const label of fileLabels) {
    if (!matched.has(label)) failures.push(`${label} (no \\proves{${label}} proof block in ${display}; refresh_blueprint_metadata or check the source)`);
  }
  const synced = fileLabels.filter((label) => matched.has(label));
  if (synced.length && rewritten !== fileSource) {
    try {
      atomicWriteText(filePath, rewritten);
    } catch (error) {
      for (const label of synced) failures.push(`${label} (failed to write ${display}: ${String(error)})`);
      return [];
    }
  }
  return synced;
}

/**
 * Write the proof `\leanok` for proofs living outside their own chapter,
 * one rewrite per file. Only the proof marker is touched; the statement's
 * tag block was already written where the statement lives.
 */
function rewriteProofFiles(
  clonePath: string,
  pending: Record<string, DeclarationTags>,
  proofSources: Record<string, string>,
  failures: string[],
): Set<string> {
  const labelsByFile = new Map<string, string[]>();
  for (const [label, sourceFile] of Object.entries(proofSources)) {
    const safeSource = safeBlueprintFilePath(sourceFile);
    if (safeSource === null) {
      failures.push(`${label} (unusable proof source path ${JSON.stringify(sourceFile)})`);
      continue;
    }
    const filePath = clonePathOf(clonePath, safeSource);
    const containment = pathContainmentError(clonePath, filePath, 'blueprint proof source');
    if (containment) {
      failures.push(`${label} (${containment})`);
      continue;
    }
    const bucket = labelsByFile.get(filePath) ?? [];
    bucket.push(label);
    labelsByFile.set(filePath, bucket);
  }
  const synced = new Set<string>();
  for (const [filePath, fileLabels] of labelsByFile) {
    for (const label of rewriteOneProofFile(clonePath, filePath, fileLabels, pending, failures)) synced.add(label);
  }
  return synced;
}

/**
 * Rewrite each declaration's `.tex` tag block in its own source file and
 * return the set of labels whose tags were synced. Labels that cannot be
 * synced — file outside the clone, unreadable, unwritable, or the label is
 * not present in that file — are appended to `failures`.
 *
 * `pendingProofSource` maps the labels whose `\proves`-linked proof is
 * written in a different chapter to that chapter; their proof `\leanok` is
 * written in a second pass, and such a label counts as synced only when
 * both passes succeeded.
 */
export function rewriteTagsAcrossFiles(
  clonePath: string,
  entrypoint: string,
  pendingTags: LabelMap<DeclarationTags>,
  pendingSourceFiles: LabelMap<string>,
  failures: string[],
  pendingProofSourceFiles: LabelMap<string> = {},
): Set<string> {
  const pending = toRecord(pendingTags);
  const pendingSource = toRecord(pendingSourceFiles);
  const pendingProofSource = toRecord(pendingProofSourceFiles);
  const labelsByFile = groupLabelsByFile(clonePath, absoluteEntrypoint(clonePath, entrypoint), pending, pendingSource, failures);
  const matched = new Set<string>();
  for (const [filePath, fileLabels] of labelsByFile) {
    for (const label of rewriteOneFile(clonePath, filePath, fileLabels, pending, failures)) matched.add(label);
  }
  const crossFile: Record<string, string> = {};
  for (const [label, sourceFile] of Object.entries(pendingProofSource)) if (matched.has(label)) crossFile[label] = sourceFile;
  if (!Object.keys(crossFile).length) return matched;
  const proofSynced = rewriteProofFiles(clonePath, pending, crossFile, failures);
  return new Set([...matched].filter((label) => !(label in crossFile) || proofSynced.has(label)));
}

// ── Status planning (from the web's mcp/blueprint/status.py) ───────────────

/** Validated declaration tag and model updates for one status request. */
export interface DeclarationStatusPlan {
  /** Source tags keyed by resolved blueprint label. */
  pending: Record<string, DeclarationTags>;
  /** Effective stored status keyed by resolved label. */
  statuses: Record<string, string>;
  /** Stored source file keyed by resolved label. */
  sources: Record<string, string>;
  /** Proof's own source file, for the labels whose proof lives elsewhere. */
  proofSources: Record<string, string>;
  /** Labels skipped during validation or source synchronization. */
  failures: string[];
  /** Lean-name-to-label resolutions reported to the caller. */
  resolutions: string[];
  /** Statement-only labels normalized to terminal status. */
  normalized: string[];
}

const EMPTY_TAGS: DeclarationTags = {
  leanName: '',
  leanFile: '',
  uses: [],
  leanok: false,
  proofLeanok: false,
  createMissingProof: false,
  proofInOtherFile: false,
};

/** The source tags associated with one effective status for a row. */
export function declarationTagsForStatus(row: DeclarationRow, status: string): DeclarationTags {
  if (status === 'not_started') return { ...EMPTY_TAGS, uses: [] };
  return tagsFromDeclaration({ ...declarationToJson(row), status });
}

/**
 * Resolve requested labels (exact label, else unique Lean name) and prepare
 * the source/model updates. `in_progress` on a statement-only declaration
 * without a proof becomes `proved` (formalizing the statement completes
 * it); when `requireFormalizationData` is set a row without a Lean name is
 * a failure.
 */
export function planDeclarationStatusUpdates(
  rows: DeclarationRow[],
  labels: string[],
  targetStatus: string,
  requireFormalizationData: boolean,
): DeclarationStatusPlan {
  const plan: DeclarationStatusPlan = { pending: {}, statuses: {}, sources: {}, proofSources: {}, failures: [], resolutions: [], normalized: [] };
  const rowsByLabel = new Map(rows.map((row) => [row.label, row]));
  for (const requested of labels) {
    let row = rowsByLabel.get(requested) ?? null;
    if (!row) {
      row = resolveDeclarationByLeanName(rows, requested);
      if (!row) {
        plan.failures.push(`${requested} (no declaration with this label or Lean name; pass the blueprint \\label value, e.g. 'lem:...')`);
        continue;
      }
      plan.resolutions.push(`'${requested}' -> '${row.label}'`);
    }
    if (row.label in plan.pending) continue;
    if (requireFormalizationData && !row.leanDeclaration) {
      plan.failures.push(`${row.label} (no leanDeclaration; run formalizer)`);
      continue;
    }
    let effectiveStatus = targetStatus;
    if (targetStatus === 'in_progress' && formalizationIsTerminal(row.kind, row.proof !== null)) {
      effectiveStatus = 'proved';
      plan.normalized.push(row.label);
    }
    plan.statuses[row.label] = effectiveStatus;
    plan.pending[row.label] = declarationTagsForStatus(row, effectiveStatus);
    plan.sources[row.label] = row.sourceFile || '';
    const proofSource = row.proofSourceFile || '';
    if (proofSource && proofSource !== plan.sources[row.label]) plan.proofSources[row.label] = proofSource;
  }
  return plan;
}

/**
 * Synchronize source tags, then store matching statuses on the model for
 * the labels that were synced. Returns the successful labels; the caller
 * persists the model.
 */
export function applyDeclarationStatusPlan(model: BlueprintModel, clonePath: string, texPath: string, plan: DeclarationStatusPlan): string[] {
  const matched = rewriteTagsAcrossFiles(clonePath, texPath, plan.pending, plan.sources, plan.failures, plan.proofSources);
  const successes = Object.keys(plan.pending).filter((label) => matched.has(label));
  for (const label of successes) setDeclarationStatus(model, label, plan.statuses[label]);
  return successes;
}

/** Format the complete status-update result for the tool caller. */
export function declarationStatusSummary(plan: DeclarationStatusPlan, successes: string[], targetStatus: string): string {
  const parts: string[] = [];
  if (successes.length) parts.push(`Set status of ${successes.length} declaration(s) to '${targetStatus}': ${successes.join(', ')}.`);
  const successful = new Set(successes);
  const normalized = plan.normalized.filter((label) => successful.has(label));
  if (normalized.length) parts.push(`Normalized 'formalized' -> terminal for statement-only declaration(s): ${normalized.join(', ')}.`);
  if (plan.resolutions.length) parts.push(`Resolved Lean names to labels: ${plan.resolutions.join('; ')} (pass the blueprint label directly next time).`);
  if (plan.failures.length) parts.push(`Skipped: ${plan.failures.join('; ')}.`);
  return parts.length ? parts.join(' ') : 'Error: no declarations were marked.';
}
