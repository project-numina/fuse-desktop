/**
 * The in-memory blueprint model and its ownership rules.
 *
 * The web backend keeps one `blueprint_declarations` row per `\label`; the
 * desktop keeps the same rows in memory and persists them as JSON next to the
 * workspace (`<blueprintDir>/model.json`). Every write path honours the
 * three-category ownership model:
 *
 * - parser-owned columns (kind, title, statement, proof, uses, source files,
 *   status) are overwritten on every refresh from the `.tex`;
 * - source-linked columns (`leanDeclaration`, `leanFile`) are written by the
 *   parser only when the `.tex` carries a non-empty tag, so an agent-written
 *   Lean name survives a commit whose source has no `\lean{}`;
 * - agent-owned columns (assessment, notes, issues, scratchFile,
 *   relevantDeclarations) are never touched by a refresh.
 *
 * `status` is derived from the `\leanok` markers and is not directly
 * agent-writable: the `set_declaration_status` tool rewrites the markers first
 * (see tex-sync.ts), then calls `setDeclarationStatus`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BlueprintEntry, PullRequestMode } from '@shared/api-types';
import type { AppPaths } from '../../paths';
import type { BlueprintRow } from '../../store/rows';

export interface RelevantDeclaration {
  name: string;
  source?: string;
  location?: string;
  signature?: string;
  relevance?: string;
}

/** One declaration row, keyed by its blueprint label. */
export interface DeclarationRow {
  label: string;
  sortIndex: number;
  // parser-owned (overwritten every refresh)
  kind: string;
  title: string;
  statement: string;
  proof: string | null;
  uses: string[];
  sourceFile: string;
  /** The `.tex` holding a `\proves`-linked proof when it is not `sourceFile`. */
  proofSourceFile: string;
  /** '' | not_started | in_progress | proved ('' only for rows seeded without a parse). */
  status: string;
  // source-linked (parser sets only when the .tex carries a non-empty tag)
  leanDeclaration: string;
  leanFile: string;
  // agent-owned (preserved across refresh)
  assessment: string;
  notes: string;
  issues: string[];
  scratchFile: string;
  relevantDeclarations: RelevantDeclaration[];
}

/** Parser output for one declaration, normalized for the model. */
export interface ParsedDeclaration {
  label: string;
  kind: string;
  title: string;
  statement: string;
  proof: string | null;
  uses: string[];
  sourceFile: string;
  proofSourceFile: string;
  leanDeclaration: string;
  leanFile: string;
  status: string;
}

/** Normalized parser output for a whole blueprint (see metadata.ts). */
export interface ParsedBlueprintSource {
  declarations: ParsedDeclaration[];
  /** Entrypoint first, then the `\input` chain in pre-order. */
  includedFiles: string[];
  /**
   * Repo-relative `\input` / `\include` targets inside the clone that could
   * not be read (not written yet, deleted, undecodable). Not chapters, but the
   * file watcher must see them appear.
   */
  missingIncludes?: string[];
  /** Every `\label{...}` in the comment-masked expanded source. */
  labelsInSource: Set<string>;
}

/**
 * The persisted per-workspace model. Blueprint scalars that the UI edits
 * (title, notes, area, pr_mode, ...) live on the registry's BlueprintRow;
 * this holds what the parser and the agents produce.
 */
export interface BlueprintModel {
  /** Cached include list from the last refresh (entrypoint first). */
  includedFiles: string[];
  /** Include targets the last refresh could not read (see `ParsedBlueprintSource.missingIncludes`). */
  missingIncludes: string[];
  /** Incremented by every parser refresh. */
  parserRevision: number;
  /** Lean module hint used when no declaration names a file. */
  leanModule: string | null;
  declarations: Map<string, DeclarationRow>;
}

const MODEL_VERSION = 1;

export function createEmptyModel(): BlueprintModel {
  return { includedFiles: [], missingIncludes: [], parserRevision: 0, leanModule: null, declarations: new Map() };
}

export function newDeclarationRow(label: string): DeclarationRow {
  return {
    label,
    sortIndex: 0,
    kind: '',
    title: '',
    statement: '',
    proof: null,
    uses: [],
    sourceFile: '',
    proofSourceFile: '',
    status: '',
    leanDeclaration: '',
    leanFile: '',
    assessment: '',
    notes: '',
    issues: [],
    scratchFile: '',
    relevantDeclarations: [],
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

/** Name of the model file inside the app's per-blueprint data directory. */
export const MODEL_FILE_NAME = 'model.json';

/**
 * Fallback sidecar used when a caller hands `loadModel`/`saveModel` a
 * project directory instead of a file (the shape the port spec's §18
 * signature suggests). Kept inside a dot-folder so it stays out of the way,
 * but the app-data location from `modelFilePath` is the intended home.
 */
export const PROJECT_SIDECAR = ['.fuse-desktop', 'blueprint.json'] as const;

/** The model file for a blueprint under the app's data directory. */
export function modelFilePath(paths: Pick<AppPaths, 'blueprintDir'>, repositoryId: number, blueprintId: string): string {
  return join(paths.blueprintDir(repositoryId, blueprintId), MODEL_FILE_NAME);
}

/**
 * Where the model lives for a given target: a `.json` path is used as is;
 * anything else is treated as a project directory holding the sidecar. A
 * directory must never be written over, so the distinction is by shape,
 * not by existence.
 */
export function resolveModelFile(target: string): string {
  if (target.toLowerCase().endsWith('.json')) return target;
  return join(target, ...PROJECT_SIDECAR);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function rowFromJson(raw: unknown, index: number): DeclarationRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const label = asString(data.label);
  if (!label) return null;
  const row = newDeclarationRow(label);
  row.sortIndex = typeof data.sortIndex === 'number' ? data.sortIndex : index;
  row.kind = asString(data.kind);
  row.title = asString(data.title);
  row.statement = asString(data.statement);
  row.proof = typeof data.proof === 'string' ? data.proof : null;
  row.uses = asStringList(data.uses);
  row.sourceFile = asString(data.sourceFile);
  row.proofSourceFile = asString(data.proofSourceFile);
  row.status = asString(data.status);
  row.leanDeclaration = asString(data.leanDeclaration);
  row.leanFile = asString(data.leanFile);
  row.assessment = asString(data.assessment);
  row.notes = asString(data.notes);
  row.issues = asStringList(data.issues);
  row.scratchFile = asString(data.scratchFile);
  row.relevantDeclarations = coerceRelevantDeclarations(data.relevantDeclarations);
  return row;
}

/**
 * Load a model from its JSON file (or a project directory's sidecar, see
 * `resolveModelFile`); a missing or unreadable file yields an empty model.
 */
export function loadModel(target: string): BlueprintModel {
  const filePath = resolveModelFile(target);
  const model = createEmptyModel();
  if (!existsSync(filePath)) return model;
  let raw: unknown;
  try {
    if (!statSync(filePath).isFile()) return model;
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`[blueprint] Unreadable model ${filePath}; starting fresh:`, error);
    return model;
  }
  if (!raw || typeof raw !== 'object') return model;
  const data = raw as Record<string, unknown>;
  model.includedFiles = asStringList(data.included_files);
  model.missingIncludes = asStringList(data.missing_includes);
  model.parserRevision = typeof data.parser_revision === 'number' ? data.parser_revision : 0;
  model.leanModule = typeof data.lean_module === 'string' && data.lean_module ? data.lean_module : null;
  const rows = Array.isArray(data.declarations) ? data.declarations : [];
  rows.forEach((entry, index) => {
    const row = rowFromJson(entry, index);
    if (row && !model.declarations.has(row.label)) model.declarations.set(row.label, row);
  });
  return model;
}

/** Write the model atomically (temp file + rename) so a crash never leaves a torn file. */
export function saveModel(target: string, model: BlueprintModel): void {
  const filePath = resolveModelFile(target);
  const payload = {
    version: MODEL_VERSION,
    included_files: model.includedFiles,
    missing_includes: model.missingIncludes,
    parser_revision: model.parserRevision,
    lean_module: model.leanModule,
    declarations: listDeclarations(model).map((row) => ({ ...declarationToJson(row), sortIndex: row.sortIndex })),
  };
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, JSON.stringify(payload, null, 2));
  renameSync(temporary, filePath);
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Rows in document order (`sortIndex`, then label). */
export function listDeclarations(model: BlueprintModel): DeclarationRow[] {
  return [...model.declarations.values()].sort((a, b) => {
    if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

export function getDeclaration(model: BlueprintModel, label: string): DeclarationRow | null {
  return model.declarations.get(label) ?? null;
}

/**
 * Resolve a non-label reference (a Lean declaration name) to its row.
 *
 * Agents have passed the Lean name (`Foo.bar` or `bar`), sometimes prefixed
 * like a label (`thm:bar`), instead of the blueprint label. Accept such a
 * reference only when it identifies exactly one declaration; ambiguous or
 * unknown names stay unresolved so a wrong declaration is never matched.
 */
export function resolveDeclarationByLeanName<T extends { label: string; leanDeclaration: string }>(
  rows: T[],
  reference: string,
): T | null {
  const colon = reference.indexOf(':');
  const bare = colon >= 0 ? reference.slice(colon + 1) : reference;
  const matches = rows.filter((row) => {
    if (!row.leanDeclaration) return false;
    const lastSegment = row.leanDeclaration.slice(row.leanDeclaration.lastIndexOf('.') + 1);
    return reference === row.leanDeclaration || bare === row.leanDeclaration || bare === lastSegment;
  });
  return matches.length === 1 ? matches[0] : null;
}

/** A declaration by exact label, else by unique Lean name. */
export function getDeclarationByReference(model: BlueprintModel, reference: string): DeclarationRow | null {
  return getDeclaration(model, reference) ?? resolveDeclarationByLeanName(listDeclarations(model), reference);
}

// ── Views ──────────────────────────────────────────────────────────────────

/** Map a declaration row to the API `BlueprintEntry` shape. */
export function declarationToEntry(row: DeclarationRow): BlueprintEntry {
  return {
    kind: row.kind,
    label: row.label,
    title: row.title || row.label,
    lean_name: row.leanDeclaration,
    lean_file: row.leanFile,
    lean_line: 0,
    uses: [...row.uses],
    statement: row.statement,
    proof: row.proof,
    issues: [...row.issues],
    status: row.status as BlueprintEntry['status'],
    source_file: row.sourceFile,
  };
}

/** Render a declaration row as the agent-facing (camelCase) JSON object. */
export function declarationToJson(row: DeclarationRow): Record<string, unknown> {
  return {
    label: row.label,
    kind: row.kind,
    title: row.title,
    leanDeclaration: row.leanDeclaration,
    leanFile: row.leanFile,
    uses: [...row.uses],
    statement: row.statement,
    proof: row.proof,
    sourceFile: row.sourceFile,
    proofSourceFile: row.proofSourceFile,
    status: row.status,
    assessment: row.assessment,
    notes: row.notes,
    issues: [...row.issues],
    scratchFile: row.scratchFile,
    relevantDeclarations: row.relevantDeclarations.map((entry) => ({ ...entry })),
  };
}

const VALID_PR_MODES: ReadonlySet<string> = new Set(['off', 'draft', 'ready']);

/**
 * `(pr_mode, auto_commit)` from a blueprint row. Forgiving like the web's
 * reader: an unknown stored value falls back to the neutral default rather
 * than breaking the detail endpoint.
 */
export function blueprintSettings(row: Pick<BlueprintRow, 'pr_mode' | 'auto_commit'>): { prMode: PullRequestMode; autoCommit: boolean } {
  const prMode = VALID_PR_MODES.has(row.pr_mode) ? row.pr_mode : 'off';
  const autoCommit = false;
  return { prMode, autoCommit };
}

// ── Parser refresh (three-category ownership upsert) ───────────────────────

function applyParserOwned(row: DeclarationRow, parsed: ParsedDeclaration): void {
  row.kind = parsed.kind;
  row.title = parsed.title;
  row.statement = parsed.statement;
  row.proof = parsed.proof;
  row.uses = [...parsed.uses];
  row.sourceFile = parsed.sourceFile;
  row.proofSourceFile = parsed.proofSourceFile;
  // The .tex is the source of truth for formalization status: the \leanok
  // markers the parser read decide it. set_declaration_status keeps the
  // markers and this column in lockstep, so overwriting here is a no-op for
  // tool-driven flips and recovers the right status on import.
  row.status = parsed.status;
  // Source-override rule: the parser sets the Lean fields only when the .tex
  // carries explicit tags (non-empty parsed value). Otherwise the
  // agent-written value is preserved — clobbering it with empties on every
  // commit was the #411 regression.
  if (parsed.leanDeclaration) row.leanDeclaration = parsed.leanDeclaration;
  if (parsed.leanFile) row.leanFile = parsed.leanFile;
}

/**
 * Upsert parsed declarations and refresh the cached include list.
 *
 * Overwrites parser-owned columns (including `status`), applies the
 * source-override rule for the Lean fields, preserves agent-owned columns,
 * and deletes declarations whose label is no longer present in the source. A
 * label that is still textually present (`\label{...}`) but missing from the
 * parsed set is preserved — the parser likely tripped on broken LaTeX.
 */
export function applyParserRefresh(model: BlueprintModel, parsed: ParsedBlueprintSource): void {
  const existing = model.declarations;
  const parsedLabels = new Set<string>();
  parsed.declarations.forEach((declaration, sortIndex) => {
    // A label is the primary key; a source with a duplicate \label (or a
    // chapter reached twice) keeps the first occurrence and skips the rest.
    if (parsedLabels.has(declaration.label)) {
      console.warn(`[blueprint] Duplicate label ${declaration.label} in blueprint source; keeping the first occurrence`);
      return;
    }
    parsedLabels.add(declaration.label);
    let row = existing.get(declaration.label);
    if (!row) {
      row = newDeclarationRow(declaration.label);
      existing.set(declaration.label, row);
    }
    row.sortIndex = sortIndex;
    applyParserOwned(row, declaration);
  });
  for (const label of [...existing.keys()]) {
    if (!parsedLabels.has(label) && !parsed.labelsInSource.has(label)) existing.delete(label);
  }
  model.includedFiles = [...parsed.includedFiles];
  model.missingIncludes = [...(parsed.missingIncludes ?? [])];
  model.parserRevision += 1;
}

// ── Declaration mutations (agent / MCP) ────────────────────────────────────

/**
 * JSON field name → row column for agent-writable declaration fields that
 * map one-to-one onto a column. `status` is intentionally absent (derived
 * from the `.tex`); `relevantDeclarations` is handled separately because its
 * entries are coerced and merged.
 */
export const AGENT_FIELD_COLUMNS: Readonly<Record<string, keyof DeclarationRow>> = Object.freeze({
  leanDeclaration: 'leanDeclaration',
  leanFile: 'leanFile',
  assessment: 'assessment',
  notes: 'notes',
  issues: 'issues',
  scratchFile: 'scratchFile',
});

export const RELEVANT_DECLARATIONS_KEY = 'relevantDeclarations';

/** Keys an agent may set on a declaration (the write allowlist). */
export const AGENT_WRITABLE_FIELDS: ReadonlySet<string> = new Set([...Object.keys(AGENT_FIELD_COLUMNS), RELEVANT_DECLARATIONS_KEY]);

const RELEVANT_DECLARATION_KEYS: ReadonlySet<string> = new Set(['name', 'source', 'location', 'signature', 'relevance']);

/**
 * Normalize one incoming entry into a `RelevantDeclaration`: a bare Lean name
 * becomes `{name}` (the pre-ADR-037 shape, still accepted); an object keeps
 * only the known keys.
 */
export function coerceRelevantDeclaration(entry: string | Record<string, unknown>): RelevantDeclaration {
  if (typeof entry === 'string') return { name: entry };
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (RELEVANT_DECLARATION_KEYS.has(key)) coerced[key] = value;
  }
  return coerced as unknown as RelevantDeclaration;
}

/**
 * Coerce an incoming `relevantDeclarations` value into objects, skipping
 * entries that are neither a name string nor an object so untrusted JSON
 * (a stray null or number) cannot crash the read path.
 */
export function coerceRelevantDeclarations(entries: unknown): RelevantDeclaration[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is string | Record<string, unknown> => typeof entry === 'string' || (!!entry && typeof entry === 'object' && !Array.isArray(entry)))
    .map(coerceRelevantDeclaration);
}

/**
 * Union two `relevantDeclarations` lists by `name` (incoming wins).
 *
 * Writes to this field are additive reuse hints: the blueprint writer records
 * cited names and the explore step enriches them, often in sequence. For a
 * name seen twice the objects are shallow-merged, with non-empty incoming
 * fields overriding; an empty or blank incoming field never overwrites an
 * already-populated one. Existing order is preserved; new names append.
 */
export function mergeRelevantDeclarations(existing: RelevantDeclaration[], incoming: RelevantDeclaration[]): RelevantDeclaration[] {
  const byName = new Map<string, RelevantDeclaration>();
  const order: string[] = [];
  for (const entry of [...existing, ...incoming]) {
    const name = entry.name;
    if (!name) continue;
    const current = byName.get(name);
    if (current) {
      const nonEmpty: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && !value.trim()) continue;
        nonEmpty[key] = value;
      }
      byName.set(name, { ...current, ...nonEmpty } as RelevantDeclaration);
    } else {
      byName.set(name, entry);
      order.push(name);
    }
  }
  return order.map((name) => byName.get(name)!);
}

/**
 * Apply agent-writable fields to a declaration by JSON field name
 * (camelCase, e.g. `leanDeclaration`). Throws on a field outside the
 * allowlist. Returns false when the declaration does not exist.
 */
export function updateDeclarationFields(model: BlueprintModel, label: string, jsonFields: Record<string, unknown>): boolean {
  const row = model.declarations.get(label);
  if (!row) return false;
  for (const [jsonName, rawValue] of Object.entries(jsonFields)) {
    if (jsonName === RELEVANT_DECLARATIONS_KEY) {
      // Merge rather than replace: the writer and the explore step both write
      // this field, so a later write must not clobber an earlier one's entries.
      row.relevantDeclarations = mergeRelevantDeclarations(row.relevantDeclarations, coerceRelevantDeclarations(rawValue));
      continue;
    }
    const column = AGENT_FIELD_COLUMNS[jsonName];
    if (!column) throw new Error(`Field '${jsonName}' is not an agent-writable field.`);
    let value = rawValue;
    if (jsonName === 'assessment' && value === null) value = '';
    if (column === 'issues') {
      row.issues = asStringList(value);
    } else {
      (row as unknown as Record<string, unknown>)[column] = typeof value === 'string' ? value : value == null ? '' : String(value);
    }
  }
  return true;
}

/** Set a declaration's status. Returns false when missing. */
export function setDeclarationStatus(model: BlueprintModel, label: string, status: string): boolean {
  const row = model.declarations.get(label);
  if (!row) return false;
  row.status = status;
  return true;
}

/** Remove every declaration; returns the count removed. */
export function deleteAllDeclarations(model: BlueprintModel): number {
  const count = model.declarations.size;
  model.declarations.clear();
  return count;
}
