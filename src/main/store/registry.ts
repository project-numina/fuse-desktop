/**
 * The local registry: opened repositories, their blueprints and sources, and
 * the conversation index. One JSON file per collection (see paths.ts).
 * Services and routes go through this module; nothing else touches the files.
 */

import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { AppPaths } from '../paths';
import { JsonFile } from './json-file';
import {
  DEFAULT_AGENT_CONFIG,
  type BlueprintRow,
  type ConversationRow,
  type RepositoryRow,
  type RepositorySourceRow,
} from './rows';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(detail);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Lowercase, spaces/underscores to '-', strip other characters (web's generate_blueprint_id). */
export function slugify(value: string, fallback = 'blueprint'): string {
  const slug = value
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || fallback;
}

interface RepositoriesDoc {
  next_id: number;
  repositories: RepositoryRow[];
}

interface BlueprintsDoc {
  blueprints: BlueprintRow[];
}

interface SourcesDoc {
  sources: RepositorySourceRow[];
}

interface ConversationsDoc {
  conversations: ConversationRow[];
}

export class Registry {
  private readonly repositories: JsonFile<RepositoriesDoc>;
  private readonly conversations: JsonFile<ConversationsDoc>;
  private readonly blueprintFiles = new Map<number, JsonFile<BlueprintsDoc>>();
  private readonly sourceFiles = new Map<number, JsonFile<SourcesDoc>>();

  constructor(readonly paths: AppPaths) {
    this.repositories = new JsonFile(paths.repositoriesIndex, () => ({ next_id: 1, repositories: [] }));
    this.conversations = new JsonFile(paths.conversationsIndex, () => ({ conversations: [] }));
  }

  // ── Repositories ─────────────────────────────────────────────────────────

  listRepositories(): RepositoryRow[] {
    return this.repositories.get().repositories.slice();
  }

  getRepository(owner: string, name: string): RepositoryRow | null {
    return this.repositories.get().repositories.find((row) => row.owner === owner && row.name === name) ?? null;
  }

  /** Throws the same 404 the web backend uses when a repository is unknown. */
  requireRepository(owner: string, name: string): RepositoryRow {
    const row = this.getRepository(owner, name);
    if (!row) throw new HttpError(404, 'Repository not found', 'http_404');
    if (!existsSync(row.path)) throw new HttpError(404, `Folder not found: ${row.path}`, 'http_404');
    return row;
  }

  getRepositoryById(id: number): RepositoryRow | null {
    return this.repositories.get().repositories.find((row) => row.id === id) ?? null;
  }

  getRepositoryByPath(path: string): RepositoryRow | null {
    const target = resolve(path);
    return this.repositories.get().repositories.find((row) => resolve(row.path) === target) ?? null;
  }

  /** Register a folder (idempotent by path). Owner/name are unique route segments. */
  addRepository(path: string): RepositoryRow {
    const absolute = resolve(path);
    const existing = this.getRepositoryByPath(absolute);
    if (existing) return existing;
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw new HttpError(404, `Folder not found: ${absolute}`, 'http_404');
    }
    const doc = this.repositories.get();
    const owner = slugify(basename(dirname(absolute)) || 'local', 'local');
    const base = slugify(basename(absolute) || 'repository', 'repository');
    let name = base;
    let suffix = 2;
    while (doc.repositories.some((row) => row.owner === owner && row.name === name)) {
      name = `${base}-${suffix}`;
      suffix += 1;
    }
    const row: RepositoryRow = {
      id: doc.next_id,
      owner,
      name,
      path: absolute,
      description: null,
      created_at: nowIso(),
      last_activity_at: null,
    };
    this.repositories.update((value) => {
      value.next_id += 1;
      value.repositories.push(row);
    });
    return row;
  }

  removeRepository(id: number): void {
    this.repositories.update((value) => {
      value.repositories = value.repositories.filter((row) => row.id !== id);
    });
  }

  touchRepository(id: number): void {
    this.repositories.update((value) => {
      const row = value.repositories.find((entry) => entry.id === id);
      if (row) row.last_activity_at = nowIso();
    });
  }

  setLeanSetupDismissed(id: number, dismissed: boolean): void {
    this.repositories.update((value) => {
      const row = value.repositories.find((entry) => entry.id === id);
      if (row) row.lean_setup_dismissed = dismissed;
    });
  }

  // ── Blueprints (workspaces) ──────────────────────────────────────────────

  private blueprintsFile(repositoryId: number): JsonFile<BlueprintsDoc> {
    let file = this.blueprintFiles.get(repositoryId);
    if (!file) {
      file = new JsonFile(this.paths.blueprintsIndex(repositoryId), () => ({ blueprints: [] }), (raw) => {
        const doc = raw as BlueprintsDoc;
        for (const row of doc.blueprints) row.agent = { ...DEFAULT_AGENT_CONFIG, ...(row.agent ?? {}) };
        return doc;
      });
      this.blueprintFiles.set(repositoryId, file);
    }
    return file;
  }

  listBlueprints(repositoryId: number): BlueprintRow[] {
    return this.blueprintsFile(repositoryId).get().blueprints.slice();
  }

  getBlueprint(repositoryId: number, id: string): BlueprintRow | null {
    return this.blueprintsFile(repositoryId).get().blueprints.find((row) => row.id === id) ?? null;
  }

  requireBlueprint(repositoryId: number, id: string): BlueprintRow {
    const row = this.getBlueprint(repositoryId, id);
    if (!row) throw new HttpError(404, 'Blueprint not found', 'http_404');
    return row;
  }

  insertBlueprint(row: BlueprintRow): void {
    this.blueprintsFile(row.repository_id).update((value) => {
      if (value.blueprints.some((entry) => entry.id === row.id)) {
        throw new HttpError(409, `A workspace named '${row.id}' already exists.`, 'http_409');
      }
      value.blueprints.push(row);
    });
    this.touchRepository(row.repository_id);
  }

  updateBlueprint(repositoryId: number, id: string, patch: Partial<BlueprintRow>): BlueprintRow {
    let updated: BlueprintRow | null = null;
    this.blueprintsFile(repositoryId).update((value) => {
      const index = value.blueprints.findIndex((entry) => entry.id === id);
      if (index < 0) throw new HttpError(404, 'Blueprint not found', 'http_404');
      updated = { ...value.blueprints[index], ...patch, updated_at: nowIso() };
      value.blueprints[index] = updated;
    });
    this.touchRepository(repositoryId);
    return updated!;
  }

  deleteBlueprint(repositoryId: number, id: string): void {
    this.blueprintsFile(repositoryId).update((value) => {
      value.blueprints = value.blueprints.filter((entry) => entry.id !== id);
    });
  }

  // ── Sources ──────────────────────────────────────────────────────────────

  private sourcesFile(repositoryId: number): JsonFile<SourcesDoc> {
    let file = this.sourceFiles.get(repositoryId);
    if (!file) {
      file = new JsonFile(this.paths.sourcesIndex(repositoryId), () => ({ sources: [] }));
      this.sourceFiles.set(repositoryId, file);
    }
    return file;
  }

  listSources(repositoryId: number): RepositorySourceRow[] {
    return this.sourcesFile(repositoryId).get().sources.slice();
  }

  getSource(repositoryId: number, id: string): RepositorySourceRow | null {
    return this.sourcesFile(repositoryId).get().sources.find((row) => row.id === id) ?? null;
  }

  insertSource(row: RepositorySourceRow): void {
    this.sourcesFile(row.repository_id).update((value) => {
      value.sources.push(row);
    });
  }

  updateSource(repositoryId: number, id: string, patch: Partial<RepositorySourceRow>): RepositorySourceRow {
    let updated: RepositorySourceRow | null = null;
    this.sourcesFile(repositoryId).update((value) => {
      const index = value.sources.findIndex((entry) => entry.id === id);
      if (index < 0) throw new HttpError(404, 'Source not found', 'http_404');
      updated = { ...value.sources[index], ...patch, updated_at: nowIso() };
      value.sources[index] = updated;
    });
    return updated!;
  }

  deleteSource(repositoryId: number, id: string): void {
    this.sourcesFile(repositoryId).update((value) => {
      value.sources = value.sources.filter((entry) => entry.id !== id);
    });
  }

  // ── Conversations index ──────────────────────────────────────────────────

  listConversations(): ConversationRow[] {
    return this.conversations.get().conversations.slice();
  }

  getConversation(id: string): ConversationRow | null {
    return this.conversations.get().conversations.find((row) => row.id === id) ?? null;
  }

  upsertConversation(row: ConversationRow): void {
    this.conversations.update((value) => {
      const index = value.conversations.findIndex((entry) => entry.id === row.id);
      if (index >= 0) value.conversations[index] = row;
      else value.conversations.push(row);
    });
    this.touchRepository(row.repository_id);
  }

  deleteConversation(id: string): void {
    this.conversations.update((value) => {
      value.conversations = value.conversations.filter((entry) => entry.id !== id);
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Write every dirty file now; each file gets its turn even if another fails. */
  flushSync(): void {
    const files = [this.repositories, this.conversations, ...this.blueprintFiles.values(), ...this.sourceFiles.values()];
    for (const file of files) {
      try {
        file.flushSync();
      } catch (error) {
        console.warn(`Failed to flush ${file.path}:`, error);
      }
    }
  }
}
