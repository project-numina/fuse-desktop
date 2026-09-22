import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AppContext } from '../../context';
import { HttpError, validationError } from '../../errors';
import type { OpenProject } from '../../../services/types';
import type { BlueprintServiceLike, LeanServiceLike } from '.';

export const PROJECT_ROUTE = '/:owner/:repo/:blueprint';
export const VALID_LABEL = /^[A-Za-z0-9][A-Za-z0-9.:_\-']*$/;
export const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_']*(\.[A-Za-z_][A-Za-z0-9_']*)*$/;
export const DECLARATION_ASSESSMENTS: ReadonlySet<string> = new Set(['IMPOSSIBLE', 'ALREADY_IN_MATHLIB']);
export const ALLOWED_DECLARATION_FIELDS: readonly string[] = ['assessment', 'issues', 'leanDeclaration', 'leanFile', 'notes', 'relevantDeclarations', 'scratchFile'];
export const ALL_DECLARATION_FIELDS: ReadonlySet<string> = new Set([
  'label', 'kind', 'title', 'leanDeclaration', 'leanFile', 'uses', 'statement', 'proof', 'sourceFile', 'proofSourceFile',
  'status', 'assessment', 'notes', 'issues', 'scratchFile', 'relevantDeclarations',
]);
export const DEFAULT_DECLARATION_FIELDS: readonly string[] = ['label', 'kind', 'title', 'status', 'leanDeclaration', 'leanFile', 'uses', 'assessment'];
const RELEVANT_DECLARATION_STRING_FIELDS = ['name', 'source', 'location', 'signature', 'relevance'];

function toPosix(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function bad(detail: string): HttpError {
  return new HttpError(400, detail, 'blueprint_tool_error');
}

export function requireService<T>(ctx: AppContext, key: string, label: string): T {
  const service = ctx.services[key];
  if (!service) throw new HttpError(503, `${label} is not available yet. Try again in a moment.`, 'service_unavailable');
  return service as T;
}

export function blueprintService(ctx: AppContext): BlueprintServiceLike {
  return requireService<BlueprintServiceLike>(ctx, 'blueprints', 'The blueprint service');
}

export function leanService(ctx: AppContext): LeanServiceLike {
  return requireService<LeanServiceLike>(ctx, 'lean', 'The Lean service');
}

/** Empty bodies are accepted as `{}`; malformed or non-object JSON is a tool error. */
export async function readJsonBody(c: { req: { text(): Promise<string> } }): Promise<Record<string, unknown>> {
  const raw = (await c.req.text()).trim();
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw bad('The request body must be a JSON object.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('The request body must be a JSON object.');
  return value as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw validationError(`${key} must be a string.`);
  return value;
}

export function requireInt(body: Record<string, unknown>, key: string, min: number): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) throw validationError(`${key} must be an integer >= ${min}.`);
  return value;
}

export function optionalInt(body: Record<string, unknown>, key: string, min: number): number | null {
  const value = body[key];
  return value === null || value === undefined ? null : requireInt(body, key, min);
}

/** Accept source paths relative to either the repository or its Lean project. */
export function normalizeSourceFilter(project: OpenProject, file: string): Set<string> {
  const candidates = new Set<string>();
  const normalized = file.replace(/\\/g, '/').replace(/^\/workspace\//, '');
  if (isAbsolute(file)) {
    const rel = relative(project.clonePath, resolve(file));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) candidates.add(toPosix(rel));
  } else {
    candidates.add(normalized.replace(/^\.\//, ''));
    if (project.projectSubdir) candidates.add(toPosix(join(project.projectSubdir, normalized)));
  }
  return candidates;
}

export function rowStatus(row: Record<string, unknown>): string {
  return str(row.status) || 'not_started';
}

/** Resolve a unique declaration by its full or unqualified Lean name. */
export function resolveDeclarationByLeanName(rows: Record<string, unknown>[], reference: string): Record<string, unknown> | null {
  const bare = reference.includes(':') ? reference.slice(reference.indexOf(':') + 1) : reference;
  const matches = rows.filter((row) => {
    const lean = str(row.leanDeclaration);
    return !!lean && (reference === lean || bare === lean || bare === lean.slice(lean.lastIndexOf('.') + 1));
  });
  return matches.length === 1 ? matches[0] : null;
}

export function findRow(rows: Record<string, unknown>[], reference: string): { row: Record<string, unknown>; resolved: boolean } | null {
  const exact = rows.find((row) => str(row.label) === reference);
  if (exact) return { row: exact, resolved: false };
  const byLean = resolveDeclarationByLeanName(rows, reference);
  return byLean ? { row: byLean, resolved: true } : null;
}

export function validateLabel(label: string): string | null {
  if (!label || !VALID_LABEL.test(label) || label.includes('..')) {
    return `Error: invalid declaration label '${label}'. Labels must contain only letters, digits, '.', ':', '_', '-', or non-leading apostrophes (no '..' path segments).`;
  }
  return null;
}

function validateRelevantDeclarations(value: unknown): string | null {
  if (!Array.isArray(value)) return "Error: 'relevantDeclarations' must be a list.";
  for (const entry of value) {
    if (typeof entry === 'string') continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return "Error: each 'relevantDeclarations' entry must be a name string or an object.";
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name) return "Error: each 'relevantDeclarations' entry needs a non-empty 'name'.";
    for (const field of RELEVANT_DECLARATION_STRING_FIELDS) {
      if (field in record && typeof record[field] !== 'string') return `Error: 'relevantDeclarations' entry '${field}' must be a string.`;
    }
  }
  return null;
}

/** Validate the metadata fields agents may update without rewriting status tags. */
export function validateDeclarationFields(fields: unknown): string | null {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return "Error: 'fields' must be an object mapping field name to value.";
  for (const [name, value] of Object.entries(fields as Record<string, unknown>)) {
    if (name === 'status') return "Error: 'status' is not settable via update_declarations. Use set_declaration_status so the status and the .tex tags stay in sync.";
    if (!ALLOWED_DECLARATION_FIELDS.includes(name)) return `Error: field '${name}' is not settable via update_declarations. Allowed fields: ${JSON.stringify(ALLOWED_DECLARATION_FIELDS)}.`;
    if (name === 'assessment' && value !== null && !DECLARATION_ASSESSMENTS.has(str(value))) {
      return `Error: invalid assessment '${str(value)}'. Expected null or one of ${JSON.stringify([...DECLARATION_ASSESSMENTS].sort())}.`;
    }
    if (name === 'issues' && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))) return "Error: 'issues' must be a list of strings.";
    if (name === 'relevantDeclarations') {
      const error = validateRelevantDeclarations(value);
      if (error) return error;
    }
  }
  return null;
}

export function projectDeclaration(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, field === 'status' ? rowStatus(row) : (row[field] ?? null)]));
}
