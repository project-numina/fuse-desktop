# Backend service contracts

The main process re-implements the slice of the Fuse web backend the frontend
needs, behind the same `/api/...` routes. Modules are developed independently;
this file pins the import paths and the shapes they exchange so they compose.

Common ground (already written):

- `src/shared/api-types.ts` — every response/request shape, snake_case, exactly
  as the frontend reads it. Routes return these.
- `src/main/server/errors.ts` — throw `new HttpError(status, detail, code?, retryAfterSeconds?)`;
  the app turns it into the `{detail, code, request_id}` envelope.
- `src/main/store/registry.ts` — `Registry`: repositories, blueprints
  (workspaces), sources, conversations index (JSON files). Row types in `rows.ts`.
- `src/main/server/sse.ts` — `SseRoom` / `SseRooms`: ids, replay, heartbeat,
  overflow. `ctx.blueprintRooms.get(roomKey)` and `ctx.sessionRooms.get(sessionId)`.
- `src/main/server/context.ts` — `AppContext` passed to every route factory.
  Services register singletons in `ctx.services` under the keys listed below.
- `src/main/services/types.ts` — `OpenProject` (the clone/blueprint tuple).
- `src/main/agents/*` — Claude Code / Codex adapters emitting `AgentEvent`
  (`src/shared/agent-events.ts`).

## Module map and `ctx.services` keys

| module | import path | registers |
| --- | --- | --- |
| LaTeX/blueprint core (pure) | `@main/services/blueprint/latex/*`, `@main/services/blueprint/dependency-graph` | — |
| Blueprint model + assembly | `@main/services/blueprint/{paths,metadata,model,lean-files,lean-locations,read,edit,tex-sync}` | — |
| Blueprint service (glue + routes) | `@main/services/blueprint-service` | `ctx.services.blueprints: BlueprintService` |
| Lean | `@main/services/lean` | `ctx.services.lean: LeanService` |
| Git | `@main/services/git` | — (pure functions taking a cwd) |
| Workspaces | `@main/services/workspace` | — |
| Sources | `@main/services/sources` | `ctx.services.sources: SourceService` |
| Sessions | `@main/services/sessions` | `ctx.services.sessions: SessionService` |
| MCP server | `src/mcp/*` (separate process, talks HTTP to `/api/internal/*`) | — |

### `BlueprintService` (`@main/services/blueprint-service`)

```ts
class BlueprintService {
  constructor(ctx: AppContext);
  openProject(owner: string, repo: string, blueprintId: string): OpenProject;      // throws HttpError 404
  getBlueprint(project: OpenProject): Promise<BlueprintResponse>;                     // full detail payload
  listBlueprints(repository: RepositoryRow): Promise<BlueprintSummary[]>;
  readChapter(project, chapterPath: string): Promise<BlueprintChapterContent>;
  writeChapter(project, chapterPath: string, content: string): Promise<void>;        // then refresh + publish
  refresh(project): Promise<void>;                                                    // re-parse entries into the model store
  publish(project, event: string, data: unknown): void;                              // blueprint room event
  // model access for the MCP internal routes:
  listDeclarations(project): Promise<Record<string, unknown>[]>;
  updateDeclaration(project, label: string, fields: Record<string, unknown>): Promise<boolean>;
  setDeclarationStatus(project, label: string, status: string): Promise<{ ok: boolean; rewritten: string[] }>;
}
```

### `LeanService` (`@main/services/lean`)

```ts
class LeanService {
  constructor(ctx: AppContext);
  buildStatus(project: OpenProject): BlueprintBuildStatus;                 // from .lake/.build-stamp.json
  buildSnapshot(project): BuildSnapshotEvent | null;                        // in-flight or persisted-stamp snapshot
  errorCounts(project): BuildErrorCounts;                                   // from .lake/.build-errors.json
  startBuild(project, opts?: { reason?: string; target?: string }): Promise<BuildOutcome>; // coalesced; publishes build_status
  goals(project, req: GoalRequest): Promise<GoalResponse>;
  hover(project, req: HoverRequest): Promise<HoverResponse>;
  diagnostics(project, req: DiagnosticRequest, signal?: AbortSignal): Promise<DiagnosticResponse>;
  cachedDiagnostics(project, req: DiagnosticRequest): DiagnosticResponse;
  reload(project, req: ReloadFileRequest): Promise<OkResponse>;
  save(project, req: FileSaveRequest): Promise<OkResponse>;
  loogle(query: string): Promise<unknown>;
  shutdown(): Promise<void>;
}
```

Errors: `lean_build_in_progress` (409), `lean_file_not_found` (404),
`lean_cursor_out_of_range` (400), `lean_query_retry` (409, Retry-After: 2).

### Git (`@main/services/git`) — pure functions, `cwd` = repository folder

```ts
isGitRepository(cwd): Promise<boolean>; currentBranch(cwd): Promise<string|null>;
listCommits(cwd, ref: string, limit: number): Promise<BlueprintCommit[]>;
commitDetail(cwd, sha): Promise<BlueprintCommitDetail>;
workingTreeDiff(cwd, opts?): Promise<BlueprintDiffResponse>;
commitChanges(cwd, opts: { message?: string|null; identity; author?; validate? }): Promise<BlueprintCommitResult>;
syncBranch(cwd, branch): Promise<BlueprintSyncResult>; syncFromMain(cwd, base?): Promise<BlueprintMainSyncResult>;
branchStatus(cwd, branch): Promise<BlueprintBranchStatus|null>; branchFreshness(cwd, base?): Promise<BranchFreshness|null>;
defaultCompareRef(cwd): Promise<string|null>; leanFileDiffStats(cwd, ref): Promise<Record<string, FileDiffStats>>;
weeklyCommits(cwd): Promise<number[]>;
```

### Workspaces (`@main/services/workspace`)

```ts
generateBlueprintId(title): string; validateModuleName(name): string; validateProjectSubdir(dir): string;
discoverLakefiles(cwd): Promise<RepositoryLakefiles>; scaffoldLeanProject(cwd, opts): Promise<RepositorySetupResult>;
createWorkspace(ctx, repository, fields: CreateWorkspaceFields, file?: {name, bytes}): Promise<CreateWorkspaceResponse>;
createStarterBlueprint(project): Promise<BlueprintSourceFileResponse>;
deleteWorkspace(ctx, project): Promise<void>;
```

### `SourceService` (`@main/services/sources`)

Stores uploads under `paths.sourcesDir(repositoryId)/<id>/`, serves artifacts
with Range support, keeps the web's naming/visibility/limit rules.

### `SessionService` (`@main/services/sessions`)

Implements every `/sessions/*` route (create, message, cancel, state, live,
wait, history list/detail/subagent/delete, recent conversations, active
sessions) on top of the agent adapters, persisting transcripts in the
web's `PersistedChatMessage` / tool-row format and publishing the session SSE
events with the exact `assistant_turn_id` formula. Also exposes
`activeSessionsForRepository(repositoryId)` for the dashboard's
background-sessions route.

```ts
class SessionService {
  constructor(ctx: AppContext, options?: SessionServiceOptions);   // registers ctx.services.sessions and REPLACES
                                                                    // ctx.sessionRooms with rooms that carry the build snapshot
  createSession(body: SessionCreate): Promise<SessionResponse>;
  sendMessage(sessionId, body: MessageCreate): Promise<SessionMessageResponse>;
  cancel(sessionId): Promise<SessionCancelResponse>;
  respondPermission(sessionId, requestId, decision: PermissionDecision): Promise<void>;
  state(sessionId): SessionState;  wait(sessionId, timeoutSeconds): Promise<SessionState>;
  eventsResponse(c: Context, sessionId): Response;                  // SSE, build_snapshot prefix from ctx.services.lean
  liveForConversation(conversationId): ConversationLiveSession;     // throws 404
  activeSessions(): ActiveSessionList;
  listHistory(owner, repo, blueprintName, limit, offset): Promise<SessionHistorySummary[]>;
  recentConversations(limit, offset): RecentConversationSummary[];
  historyDetail(conversationId): Promise<SessionHistoryDetail>;  subagentHistory(conversationId, ptu): Promise<SubagentHistoryDetail>;
  reviewBackground(conversationId): Promise<SessionHistoryDetail>;  deleteHistory(conversationId): Promise<void>;
  // for other modules:
  activeSessionsForRepository(repositoryId): RepositoryBackgroundSessionResponse[];   // ≤ 3, newest first
  isBlueprintBusy(repositoryId, blueprintId): boolean;  isBlueprintBusy(project: OpenProject): boolean;  // a turn is running/queued
  hasActiveSession(repositoryId, blueprintId | null): boolean;                       // any live session (delete guard)
  deleteConversation(conversationId): Promise<void>;                                  // stop + remove transcript
  shutdown(): Promise<void>;                                                          // app quit: end every session `completed`
}
```

Sessions call `ctx.services.blueprints.openProject`, `ctx.services.lean.{buildStatus,buildSnapshot}`,
`ctx.services.attention.observe`. Sessions never commit or push, including when a legacy
`BlueprintRow.auto_commit` value is true. Opening workspaces, querying the editor, and finishing turns never start builds.
Only explicit user builds or agent `lean_build` calls prepare dependencies and build the project.
Prompts come from `resources/prompts/system-prompt.md` (Claude) /
`system-prompt-codex.md` (Codex) with `{repo_root} {project_root} {blueprint_tex} {blueprint_name} {lean_module}`
placeholders, plus `resources/prompts/blueprint` as the Claude plugin dir.

### Native history

Workspace History discovers exact-folder sessions through Claude Agent SDK's read-only
`listSessions`/`getSessionMessages` helpers and Codex app-server's `thread/list`/`thread/read`.
No agent turn is started by browsing history. Provider failures are shown separately while
legacy Fuse history remains available. Discovery stores only session/workspace links.

New Fuse chats retain a crash-safe local journal until rows can be verified in native
history. Verified rows are omitted from subsequent disk writes; queued/retained messages,
attachments, and Fuse-only events remain durable. Hydration is memory-only. Old Fuse
transcripts are left intact. Removing a native chat stores a hidden marker, never deletes
or archives the provider's session. Resuming keeps the original provider and directory.

Run the opt-in `tests/main/services/sessions/native-history.live.test.ts` with `FUSE_NATIVE_HISTORY_FOLDER` set to a
folder containing sessions from both providers to verify local readers without model calls.

## Route mounting

`src/main/server/app.ts` mounts: `/api/auth`, `/api` (system), `/api/repositories`
(repositories, sources, blueprints, git, lean, pull-requests sub-apps — each
declares its own full sub-paths such as `/:owner/:repo/blueprints/:name/commits`),
`/api/sessions`, and `/api/internal` (MCP helper routes). Each factory receives
`ctx` and returns a `Hono` instance.

## Git / workspace / sources — implementation notes (append-only)

Beyond the signatures above, these modules expose:

- `@main/services/git`
  - `commitChanges(cwd, opts)` also takes `body`, `projectSubdir`, `additionalPaths`,
    `protectAutomation` (agent commits skip `.github`), `aiGenerator`, `push` (default
    true; only when the branch tracks a remote). `validate` may be `true` (uses the
    validator registered through `setDefaultCommitValidator`, e.g. by the Lean
    module; skipped when none) or a `CommitValidator` function.
  - `commitAgentTurn(cwd, { userMessage, incomplete, blueprintName, owner, repo, conversationId?, projectSubdir? })`
    — the agent autocommit (`Agent: …` subject, metadata trailer, bot identity).
  - `syncFromMain(cwd, base | { base?, identity?, validate? })`; `listCommits(cwd, ref, limit, { github? })`.
  - `currentGitIdentity(cwd, displayName)`, `githubRemote(cwd)`, `BOT_IDENTITY`,
    `generateCommitMessageWithClaude(claudePath, diff)`.
- `@main/services/workspace`
  - `resolveProject(ctx, owner, repo, name)` (400 bad name / 404), `projectFromRows(repository, blueprint)`,
    `publishBlueprintEvent(ctx, project, event, data)`.
  - `createStarterBlueprint(project, ctx?)` — with `ctx` it also persists `blueprint_file` and refreshes.
  - `readRepoFile(root, path)`, `repoFiles(root)`, `listBlueprintCandidates(root)`, `safeBlueprintFilePath`,
    `defaultBlueprintFileForProject`. Validators throw `WorkspaceValidationError` (an `HttpError` 422).
- `@main/services/sources` — `SourceService` (registered by `sourceRoutes` via `registerSourceService(ctx)`):
  `list(repository, blueprintId?)`, `get`, `requireVisibleRow`, `upload(repository, file, opts)`,
  `create(input)`, `importRepositoryFile(project, repoPath)`, `delete`, `archiveBlueprintSources(repositoryId, name)`,
  `artifact(repository, id, kind, blueprintId?)`, `pdfPreview`, `artifactPath(row, kind)`,
  `readArtifactText(row, kind)`, `canonicalSourceView(repository, blueprintName)`.
  A source's scope is its `metadata` (`blueprint_id` / `project_scoped` + `scoped_blueprint_id`);
  there is no `workspace_id` column locally.
- `SessionService` optional hooks read by `deleteWorkspace`: `hasActiveSession(repositoryId, blueprintId)`
  and `deleteConversation(id)`; otherwise `activeSessionsForRepository` (tier `active`) and the registry are used.
