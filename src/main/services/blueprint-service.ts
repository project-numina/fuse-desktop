/**
 * BlueprintService — the glue between the registry rows (which folder, which
 * entrypoint, which settings), the blueprint model (parser + declaration
 * store in `./blueprint/*`), git, the sources store, and the blueprint SSE
 * room. The `/blueprints/*` routes and the MCP internal routes call it; the
 * pure parsing and payload assembly live in `@main/services/blueprint`.
 *
 * Concurrency: the declaration model is a JSON file that every write path
 * loads, mutates and saves. Mutations are serialized per blueprint room
 * (`serialize`) so an agent's `set_declaration_status` cannot interleave
 * with a chapter save's re-parse and lose one of the two.
 */

import type {
  BlueprintChapterContent,
  BlueprintResponse,
  BlueprintSourceFileResponse,
  BlueprintSummary,
  CreateWorkspaceFields,
  CreateWorkspaceResponse,
  RepositoryBlueprintFile,
} from '@shared/api-types';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { SSE_HEARTBEAT_MS } from '../server/sse';
import type { AgentConfig, RepositoryRow } from '../store/rows';
import {
  applyParserRefresh,
  declarationToJson,
  editContextFor,
  getBlueprintFromClone,
  listDeclarations as listModelDeclarations,
  parseBlueprintSource,
  readChapterContent,
  updateBlueprintContent,
  updateChapterContent,
  updateDeclarationFields,
  listCloneBlueprintFiles,
  defaultBlueprintFileForProject,
  safeBlueprintFilePath,
  readUtf8Text,
  universalNewlines,
  type BlueprintModel,
} from './blueprint';
import { createStarterBlueprint, createWorkspace, deleteWorkspace } from './workspace';
import type { OpenProject } from './types';
import {
  missingBlueprintSourceResult,
  mutateDeclarationStatus,
  validateDeclarationStatus,
  type DeclarationStatusResult,
} from './blueprint-service/declaration-status';
import { editServiceError } from './blueprint-service/edit-errors';
import { branchState, sourceView } from './blueprint-service/external-state';
import { BlueprintModelStore } from './blueprint-service/model-store';
import { absolutePathIn, blueprintUpdatedAt, isFile, openBlueprintProject } from './blueprint-service/projects';
import {
  normalizedPrMode,
  updateBlueprintSettings,
  type BlueprintSettingsPatch,
  type DesktopBlueprintSettingsResponse,
} from './blueprint-service/settings';
import { BlueprintWatcherRooms, type WatchedRoomIdentity } from './blueprint-service/watcher-rooms';

// ── Constants shared with the web backend ──────────────────────────────────

/** `settings.max_latex_source_characters` in the web backend. */
export const MAX_LATEX_SOURCE_CHARACTERS = 50_000;
const SYNC_PUBLISH_DEBOUNCE_MS = 400;

export { safeBlueprintFilePath, defaultBlueprintFileForProject, absolutePathIn };
export { editServiceError };
export { MAX_ORCHESTRATOR_CONCURRENCY } from './blueprint-service/settings';
export type { AgentSettingsPatch, BlueprintSettingsPatch, DesktopBlueprintSettingsResponse } from './blueprint-service/settings';
export type { DeclarationStatusResult };

// ── Collaborating services (looked up on ctx.services at call time) ───────

/** The workspace module's create/delete/scaffold functions; tests inject fakes. */
export interface WorkspacePorts {
  createWorkspace(
    ctx: AppContext,
    repository: RepositoryRow,
    fields: CreateWorkspaceFields,
    file?: { name: string; bytes: Uint8Array },
  ): Promise<CreateWorkspaceResponse>;
  createStarterBlueprint(project: OpenProject): Promise<BlueprintSourceFileResponse>;
  deleteWorkspace(ctx: AppContext, project: OpenProject): Promise<void>;
}

const DEFAULT_WORKSPACE_PORTS: WorkspacePorts = { createWorkspace, createStarterBlueprint, deleteWorkspace };

interface SessionServiceLike {
  isBlueprintBusy?(project: OpenProject): boolean;
  hasActiveSession?(repositoryId: number, blueprintId: string | null): boolean;
}

/** The web payload plus the desktop-only agent block (an extra key the frontend ignores). */
export type DesktopBlueprintResponse = BlueprintResponse & { agent: AgentConfig };

// ── The service ────────────────────────────────────────────────────────────

export class BlueprintService {
  private readonly workspace: WorkspacePorts;
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly models: BlueprintModelStore;
  private readonly rooms: BlueprintWatcherRooms;
  /** Heartbeat interval for the events route; tests shorten it. */
  heartbeatMs = SSE_HEARTBEAT_MS;
  /** Watcher tuning, exposed for tests. */
  watcherOptions: { debounceMs?: number; pollIntervalMs?: number; forcePolling?: boolean } = {};

  constructor(
    private readonly ctx: AppContext,
    options: { workspace?: WorkspacePorts } = {},
  ) {
    this.workspace = options.workspace ?? DEFAULT_WORKSPACE_PORTS;
    this.models = new BlueprintModelStore(ctx.paths);
    this.rooms = new BlueprintWatcherRooms(ctx, () => this.watcherOptions, (room, changed) => this.handleExternalChange(room, changed));
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  /**
   * Resolve the route triple to the folder and workspace row. Also performs
   * the web's `adopt_project_blueprint`: a workspace with no chosen
   * entrypoint adopts `<project_subdir>/blueprint/src/content.tex` when the
   * folder has one, and that choice is persisted. Failing that, the
   * entrypoint is resolved once by existence (`resolve_existing_entrypoint`:
   * the legacy `numina/blueprints/<name>/<name>.tex` layout) so every path —
   * parse, tag sync, validate, own-write bookkeeping — agrees on the file;
   * a legacy entrypoint is read from but never persisted or written anew.
   */
  openProject(owner: string, repo: string, blueprintId: string): OpenProject {
    return openBlueprintProject(this.ctx, owner, repo, blueprintId);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The detail payload. The model refresh runs under the room lock; the
   * (git-heavy) assembly runs outside it on the refreshed snapshot so agent
   * writes are not held up by a `git diff` of a large repository.
   */
  async getBlueprint(project: OpenProject): Promise<DesktopBlueprintResponse> {
    const model = await this.serialize(project.roomKey, async () => this.refreshUnlocked(project));
    const [branch, source] = await Promise.all([branchState(project), sourceView(this.ctx, project)]);
    const base = await getBlueprintFromClone(project, model, {
      refresh: false,
      source,
      branchFreshness: branch.freshness,
      branchStatus: branch.status,
    });
    const row = project.blueprint;
    const payload: DesktopBlueprintResponse = {
      ...base,
      name: row.title || row.id,
      description: row.description ?? '',
      area: row.area ?? '',
      updated_at: blueprintUpdatedAt(row, this.ctx.registry.listConversations()),
      pr_mode: normalizedPrMode(row.pr_mode),
      auto_commit: false,
      orchestrator_child_concurrency: row.orchestrator_child_concurrency > 0 ? row.orchestrator_child_concurrency : 1,
      agent: row.agent,
    };
    this.rooms.setFiles(project.roomKey, this.models.watchFiles(project, payload.included_files, model.missingIncludes));
    return payload;
  }

  async listBlueprints(repository: RepositoryRow): Promise<BlueprintSummary[]> {
    const conversations = this.ctx.registry.listConversations().filter((row) => row.repository_id === repository.id);
    const summaries = this.ctx.registry.listBlueprints(repository.id).map((row): BlueprintSummary => {
      let entryCount = 0;
      try {
        entryCount = this.models.declarationCount(repository.id, row.id);
      } catch (error) {
        console.warn(`[blueprints] could not load the model for ${repository.owner}/${repository.name}/${row.id}:`, error);
      }
      return {
        id: row.id,
        name: row.title || row.id,
        description: row.description ?? '',
        area: row.area ?? '',
        entry_count: entryCount,
        updated_at: blueprintUpdatedAt(row, conversations),
        workspace_id: null,
        can_edit: true,
      };
    });
    summaries.sort((a, b) => (Date.parse(b.updated_at ?? '') || 0) - (Date.parse(a.updated_at ?? '') || 0));
    return summaries;
  }

  async readChapter(project: OpenProject, chapterPath: string): Promise<BlueprintChapterContent> {
    try {
      const content = await readChapterContent(editContextFor(project, this.models.load(project)), project.blueprint.id, chapterPath);
      return { path: chapterPath, content };
    } catch (error) {
      throw editServiceError(error, 'Failed to read chapter.');
    }
  }

  async listSourceCandidates(project: OpenProject): Promise<RepositoryBlueprintFile[]> {
    return listCloneBlueprintFiles(project.clonePath);
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /** Write one chapter (or the entrypoint), re-parse, and tell the UI to refetch. */
  async writeChapter(project: OpenProject, chapterPath: string, content: string): Promise<void> {
    let safePath: string;
    try {
      safePath = await updateChapterContent(editContextFor(project, this.models.load(project)), project.blueprint.id, chapterPath, content);
    } catch (error) {
      throw editServiceError(error, 'Failed to save chapter edit.');
    }
    await this.afterOwnWrite(project, safePath, content);
  }

  /** `PUT /content`: write the whole entrypoint. */
  async writeContent(project: OpenProject, latexSource: string): Promise<void> {
    try {
      await updateBlueprintContent(editContextFor(project, this.models.load(project)), project.blueprint.id, latexSource);
    } catch (error) {
      throw editServiceError(error, 'Failed to save blueprint edit.');
    }
    await this.afterOwnWrite(project, project.blueprintFile ?? defaultBlueprintFileForProject(project.projectSubdir), latexSource);
  }

  private async afterOwnWrite(project: OpenProject, relativePath: string, content: string): Promise<void> {
    this.rooms.noteOwnWrite(project.roomKey, relativePath, content);
    await this.refresh(project);
    this.markEdited(project);
    // Refetch server-side entries and statuses after each saved edit.
    this.publish(project, 'blueprint_sync', { blueprint: project.blueprint.id });
  }

  /** Re-parse the entrypoint chain into the declaration store. Publishes nothing. */
  refresh(project: OpenProject): Promise<void> {
    return this.serialize(project.roomKey, async () => {
      this.refreshUnlocked(project);
    });
  }

  /** Load, re-parse, save; returns the refreshed model (caller holds the room lock). */
  private refreshUnlocked(project: OpenProject): BlueprintModel {
    const { model, changed } = this.models.refresh(project);
    if (changed) this.rooms.setFiles(project.roomKey, this.models.watchFiles(project, model.includedFiles, model.missingIncludes));
    return model;
  }

  publish(project: OpenProject, event: string, data: unknown): void {
    this.ctx.blueprintRooms.get(project.roomKey).publish(event, data);
  }

  /** Coalesce a burst of identical events (batched agent writes) into one frame. */
  publishDebounced(project: OpenProject, event: string, data: unknown, delayMs = SYNC_PUBLISH_DEBOUNCE_MS): void {
    this.rooms.publishDebounced(project, event, data, delayMs);
  }

  updateSettings(project: OpenProject, update: BlueprintSettingsPatch): DesktopBlueprintSettingsResponse {
    return updateBlueprintSettings(this.ctx, project, update);
  }

  /**
   * Point the workspace at an entrypoint and re-parse its include chain.
   * Adopting a user-picked file requires declarations (422 otherwise, and
   * nothing is persisted); a freshly written starter file is exempt.
   */
  async setSourceFile(project: OpenProject, blueprintFile: string, options: { requireDeclarations: boolean }): Promise<BlueprintSourceFileResponse> {
    return this.serialize(project.roomKey, async () => {
      const parsed = parseBlueprintSource(project.clonePath, project.blueprint.id, blueprintFile, project.projectSubdir);
      if (options.requireDeclarations && (!parsed || parsed.declarations.length === 0)) {
        throw new HttpError(422, `${blueprintFile} has no parseable leanblueprint declarations.`, 'http_422');
      }
      if (project.blueprint.blueprint_file !== blueprintFile) {
        project.blueprint = this.ctx.registry.updateBlueprint(project.repository.id, project.blueprint.id, { blueprint_file: blueprintFile });
      }
      project.blueprintFile = blueprintFile;
      const model = this.models.load(project);
      if (parsed) {
        applyParserRefresh(model, parsed);
        this.models.save(project, model);
      }
      const included = parsed ? parsed.includedFiles : [blueprintFile];
      this.rooms.setFiles(project.roomKey, this.models.watchFiles(project, included, parsed?.missingIncludes ?? []));
      this.publish(project, 'blueprint_sync', { blueprint: project.blueprint.id });
      return { blueprint_file: blueprintFile, included_files: included, entry_count: model.declarations.size };
    });
  }

  /** `POST /create-blueprint`: adopt the conventional entrypoint or write the starter files. */
  async createBlueprint(project: OpenProject): Promise<BlueprintSourceFileResponse> {
    const entrypoint = defaultBlueprintFileForProject(project.projectSubdir);
    if (isFile(absolutePathIn(project.clonePath, entrypoint))) {
      return this.setSourceFile(project, entrypoint, { requireDeclarations: true });
    }
    // Files only (no ctx): persisting the choice and re-parsing stays here so
    // the response reflects what is on disk and the room is notified once.
    const created = await this.workspace.createStarterBlueprint(project);
    return this.setSourceFile(project, created.blueprint_file || entrypoint, { requireDeclarations: false });
  }

  async createWorkspace(repository: RepositoryRow, fields: CreateWorkspaceFields, file?: { name: string; bytes: Uint8Array }): Promise<CreateWorkspaceResponse> {
    const response = await this.workspace.createWorkspace(this.ctx, repository, fields, file);
    // Parse once so the dashboard's entry_count is right before the first open.
    try {
      await this.refresh(this.openProject(repository.owner, repository.name, response.blueprint_id));
    } catch (error) {
      console.warn(`[blueprints] initial parse after creating ${response.blueprint_id} failed:`, error);
    }
    return response;
  }

  async deleteBlueprint(project: OpenProject): Promise<void> {
    if (this.isBusy(project)) {
      throw new HttpError(409, 'Cannot delete a blueprint with active agent sessions.', 'http_409');
    }
    this.rooms.stop(project.roomKey);
    this.ctx.blueprintRooms.delete(project.roomKey);
    await this.workspace.deleteWorkspace(this.ctx, project);
    if (this.ctx.registry.getBlueprint(project.repository.id, project.blueprint.id)) {
      this.ctx.registry.deleteBlueprint(project.repository.id, project.blueprint.id);
    }
  }

  /** Repoint local Lean context without building or changing repository files. */
  async setLeanProject(project: OpenProject, directory: string): Promise<{ project_subdir: string }> {
    return this.serialize(project.roomKey, async () => {
      if (this.isBusy(project)) throw new HttpError(409, 'Stop the active agent session before changing the Lean project.', 'http_409');
      const lean = this.ctx.services.lean as { buildSnapshot(project: OpenProject): { status: string } | null } | undefined;
      if (lean?.buildSnapshot(project)?.status === 'running') {
        throw new HttpError(409, 'Wait for Lean setup to finish before changing the project.', 'http_409');
      }
      this.ctx.registry.updateBlueprint(project.repository.id, project.blueprint.id, { project_subdir: directory });
      const updated = this.openProject(project.repository.owner, project.repository.name, project.blueprint.id);
      this.refreshUnlocked(updated);
      this.publish(updated, 'blueprint_sync', { blueprint: project.blueprint.id });
      return { project_subdir: directory };
    });
  }

  // ── Declaration model access (MCP internal routes) ───────────────────────

  async listDeclarations(project: OpenProject): Promise<Record<string, unknown>[]> {
    return this.serialize(project.roomKey, async () => {
      // Parse-on-read keeps the agent's view in step with .tex files it may
      // have just edited with plain Write/Edit tools.
      const model = this.refreshUnlocked(project);
      return listModelDeclarations(model).map(declarationToJson);
    });
  }

  async updateDeclaration(project: OpenProject, label: string, fields: Record<string, unknown>): Promise<boolean> {
    return this.serialize(project.roomKey, async () => {
      const model = this.models.load(project);
      let updated: boolean;
      try {
        updated = updateDeclarationFields(model, label, fields);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error), 'http_400');
      }
      if (!updated) return false;
      this.models.save(project, model);
      this.markEdited(project);
      this.publishDebounced(project, 'blueprint_sync', { blueprint: project.blueprint.id });
      return true;
    });
  }

  /**
   * `set_declaration_status` for one label: rewrite the `.tex` tags first,
   * then record the status only when the label was matched in the source
   * (the web's ".tex before DB" rule). `status` accepts the tool names
   * (proved | formalized | unformalized) and the stored names.
   */
  async setDeclarationStatus(project: OpenProject, label: string, status: string): Promise<DeclarationStatusResult> {
    validateDeclarationStatus(status);
    return this.serialize(project.roomKey, async () => {
      const missingSource = missingBlueprintSourceResult(project);
      if (missingSource) return missingSource;
      const model = this.refreshUnlocked(project);
      const mutation = mutateDeclarationStatus(project, model, label, status, this.rooms.isWatching(project.roomKey));
      for (const [relative, content] of mutation.rewrittenContent) {
        if (content !== null) this.rooms.noteOwnWrite(project.roomKey, relative, content);
      }
      if (!mutation.persist) return mutation.result;
      this.models.save(project, model);
      // The parser re-derives the same status from the markers just written;
      // running it now keeps the store and the .tex at their fixed point.
      this.refreshUnlocked(project);
      this.markEdited(project);
      this.publishDebounced(project, 'blueprint_sync', { blueprint: project.blueprint.id });
      return mutation.result;
    });
  }

  // ── SSE room lifecycle + file watcher ────────────────────────────────────

  /**
   * Called by the events route for every subscriber. The first subscriber of
   * a room starts its file watcher; the last one leaving stops it after a
   * grace period (so a reconnect does not thrash the watcher).
   */
  retainRoom(project: OpenProject): () => void {
    const model = this.models.load(project);
    return this.rooms.retain(project, this.models.watchFiles(project, model.includedFiles, model.missingIncludes));
  }

  /** Whether a room currently has a live file watcher (tests / diagnostics). */
  isWatching(roomKey: string): boolean {
    return this.rooms.isWatching(roomKey);
  }

  /** Stop every watcher and pending timer (app shutdown). */
  shutdown(): void {
    this.rooms.shutdown();
  }

  private async handleExternalChange(state: WatchedRoomIdentity, changed: string[]): Promise<void> {
    let project: OpenProject;
    try {
      project = this.openProject(state.owner, state.repo, state.blueprintId);
    } catch {
      // The workspace or folder is gone; delete tears the room down.
      return;
    }
    try {
      await this.refresh(project);
    } catch (error) {
      console.warn(`[blueprints] re-parse after an external edit failed for ${project.roomKey}:`, error);
    }
    if (project.blueprintFile && changed.includes(project.blueprintFile)) {
      // The verbatim frontend applies `latex_source` to `blueprint_content`,
      // so this event may only ever carry the entrypoint's text, in the same
      // shape GET serves it (Python `read_text`: universal newlines, so a
      // CRLF file arrives LF-only either way).
      const raw = readUtf8Text(absolutePathIn(project.clonePath, project.blueprintFile));
      if (raw !== null) this.publish(project, 'blueprint_edit', { latex_source: universalNewlines(raw), path: project.blueprintFile });
    }
    // Any change to the chain (a chapter, a new \input, an agent's tags)
    // needs a full refetch: entries and statuses come from the server payload.
    this.publish(project, 'blueprint_sync', { blueprint: project.blueprint.id });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private isBusy(project: OpenProject): boolean {
    const sessions = this.ctx.services.sessions as SessionServiceLike | undefined;
    if (!sessions) return false;
    if (sessions.isBlueprintBusy?.(project)) return true;
    return sessions.hasActiveSession?.(project.repository.id, project.blueprint.id) === true;
  }

  /** Bump the row's `updated_at` (dashboard order) after a content edit. */
  private markEdited(project: OpenProject): void {
    try {
      project.blueprint = this.ctx.registry.updateBlueprint(project.repository.id, project.blueprint.id, {});
    } catch {
      // The row may have been deleted concurrently; nothing to bump.
    }
  }

}
