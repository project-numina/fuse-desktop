/**
 * Read-only access to the clone-local declaration-location cache
 * (`.lake/fuse-declaration-locations.json`) that a post-build Lean metadata
 * pass writes. The desktop never runs the LSP resolver itself; when the
 * cache is present (from a previous web build or a local one) it turns a
 * `\lean{}` name into an exact `(file, line)` for the blueprint response.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LEAN_LOCATIONS_CACHE_VERSION = 1;
export const LEAN_LOCATIONS_CACHE_FILE = '.lake/fuse-declaration-locations.json';
const LEAN_LIBRARY_PATTERN = /^\s*lean_lib\s+(?:«([^»]+)»|([^\s{]+))/gm;

export type LeanLocation = Record<string, unknown>;

/** Split the declaration list accepted by leanblueprint's `\lean` (unique, trimmed, non-empty). */
export function splitDeclarationNames(value: string): string[] {
  const names: string[] = [];
  for (const raw of value.split(',')) {
    const name = raw.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Normalize a module path or `.lean` file to Lean import syntax. */
function moduleName(value: string): string {
  let normalized = value.trim();
  if (normalized.endsWith('.lean')) normalized = normalized.slice(0, -'.lean'.length);
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  return normalized.replace(/\//g, '.');
}

/** Whether a module has a built `.olean` available to the language server. */
function moduleAvailable(projectRoot: string, module: string): boolean {
  const segments = module.split('.');
  const last = segments.pop()!;
  const path = join(projectRoot, '.lake', 'build', 'lib', 'lean', ...segments, `${last}.olean`);
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Declarative Lean library names from `lakefile.toml` (`[[lean_lib]]`
 * tables with a `name`). A deliberately small TOML reader: only the table
 * headers and the `name = "..."` keys are needed.
 */
function tomlLibraryNames(projectRoot: string): string[] {
  let source: string;
  try {
    source = readFileSync(join(projectRoot, 'lakefile.toml'), 'utf8');
  } catch {
    return [];
  }
  const names: string[] = [];
  let inLeanLib = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      inLeanLib = line.startsWith('[[') && header[1] === 'lean_lib';
      continue;
    }
    if (!inLeanLib) continue;
    const name = /^name\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (name) {
      const value = name[1] ?? name[2] ?? '';
      if (value) names.push(value);
      inLeanLib = false;
    }
  }
  return names;
}

/**
 * Project imports likely to expose all blueprint declarations: the configured
 * module first, then Lake library roots (`lakefile.toml` / `lakefile.lean`),
 * with root `.lean` modules as the fallback. Only built modules are kept.
 */
export function resolverImports(projectRoot: string, configuredModule: string | null): string[] {
  const candidates: string[] = [];
  if (configuredModule) {
    const module = moduleName(configuredModule);
    if (moduleAvailable(projectRoot, module)) candidates.push(module);
  }
  for (const module of tomlLibraryNames(projectRoot)) if (moduleAvailable(projectRoot, module)) candidates.push(module);
  for (const match of readTextOrEmpty(join(projectRoot, 'lakefile.lean')).matchAll(LEAN_LIBRARY_PATTERN)) {
    const module = match[1] || match[2];
    if (module && moduleAvailable(projectRoot, module)) candidates.push(module);
  }
  if (!candidates.length) {
    for (const name of rootLeanFiles(projectRoot)) {
      const stem = name.slice(0, -'.lean'.length);
      if (moduleAvailable(projectRoot, stem)) candidates.push(stem);
    }
  }
  return [...new Set(candidates.filter((candidate) => candidate))];
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Sorted `*.lean` names directly under the project root. */
function rootLeanFiles(projectRoot: string): string[] {
  try {
    return readdirSync(projectRoot).filter((name) => name.endsWith('.lean')).sort();
  } catch {
    return [];
  }
}

function readCache(projectRoot: string): Record<string, unknown> | null {
  const cachePath = join(projectRoot, ...LEAN_LOCATIONS_CACHE_FILE.split('/'));
  if (!existsSync(cachePath)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.version !== LEAN_LOCATIONS_CACHE_VERSION) return null;
  return record;
}

/** Read and validate the clone-local declaration-location map once; `{}` unless the file is usable. */
export function readCachedLeanLocations(projectRoot: string): Record<string, LeanLocation> {
  const cache = readCache(projectRoot);
  const locations = cache ? cache.locations : {};
  if (!locations || typeof locations !== 'object' || Array.isArray(locations)) return {};
  const valid: Record<string, LeanLocation> = {};
  for (const [name, location] of Object.entries(locations as Record<string, unknown>)) {
    if (location && typeof location === 'object' && !Array.isArray(location)) valid[name] = location as LeanLocation;
  }
  return valid;
}

/**
 * `(file, first start_line)` for a `\lean` value when every named
 * declaration resolves to a cached location in one common file; `('', 0)`
 * otherwise (a missing name or names split across files is not a location).
 */
export function cachedLeanLocation(locations: Record<string, LeanLocation>, declarationValue: string): [string, number] {
  const names = splitDeclarationNames(declarationValue);
  const resolved = names.map((name) => locations[name]);
  if (!names.length || resolved.some((location) => !location || typeof location !== 'object')) return ['', 0];
  const files = new Set(resolved.map((location) => String(location!.file ?? '')));
  if (files.size !== 1) return ['', 0];
  const file = [...files][0];
  if (!file) return ['', 0];
  const line = Number(resolved[0]!.start_line ?? 0);
  return [file, Number.isFinite(line) ? Math.trunc(line) : 0];
}
