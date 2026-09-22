# Developer reference

Build, architecture, and release notes for contributors and maintainers.
For a quick introduction, see the [README](../README.md).

Fuse is distributed under **AGPL-3.0-or-later**. See [LICENSE](../LICENSE) and
[third-party notices](../THIRD_PARTY.md). Original MIT copyright notices are retained
in `licenses/MIT-original.txt`; third-party components retain their own licenses.

This repository is the standalone home of Fuse. Installers are not published yet.

A local, single-user replica of the Numina Fuse web app: a Lean 4 blueprint formalization
workspace that runs on your machine, with [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
and [Codex](https://github.com/openai/codex) as the agents. Open a repository folder, create a
workspace around its blueprint, and work the way you would in the hosted app: the blueprint
graph, the LaTeX/Lean editors with live goals and diagnostics, `lake build` status, sources,
git history, and chat sessions in which the agent formalizes declarations, with every tool call
and permission prompt shown in place.

The frontend adapts the web app's React code for desktop use. The main process stands in for the web
backend: a loopback HTTP server answers the same `/api/...` routes, runs Lean builds and a
Lean language server per project, talks to git in your folders, and launches the CLIs as
agent sessions. The CLIs reach the same services through a small MCP server, so the agent and
the UI share one build queue, one language server and one blueprint model.

## Requirements

Installers will be published at [GitHub Releases](https://github.com/project-numina/fuse-desktop/releases/latest).
Use the universal macOS DMG (Apple Silicon and Intel), Windows x64 installer, or Linux x64 AppImage/DEB.
The website can link directly to this stable release page; it does not host update files.

Installed macOS/Windows and Linux AppImage builds check for stable updates on startup
and every six hours. Downloads happen in the background and install on normal quit;
Fuse never restarts an active session automatically. Use **Help → Check for Updates**
to check manually. DEB installations are updated manually by installing a newer DEB.
No GitHub sign-in is needed. An internet connection is required to check/download.

- Node.js 22.12 or newer (to build and run from source).
- At least one of the CLIs on your `PATH`, logged in:
  - `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in.
  - `npm install -g @openai/codex`, then `codex login`.
- `git`: repositories are git checkouts; history, diffs, commits and sync use it.
- A Lean toolchain via [elan](https://github.com/leanprover/elan): each project's
  `lean-toolchain` is honoured, `lake` builds it and `lake serve` powers goals, hover and
  diagnostics. `fixtures/sample-blueprint` (Lean v4.25.0) is a ready-made project to try.

If a CLI lives somewhere unusual, point Fuse at it under **Settings**.

## Publishing the standalone app

CI runs directly from this repository. The initial import is a source-only snapshot;
the former monorepo's private history is not included.

Create a GitHub environment named `release`, ideally with required reviewer approval.
Set the environment variable `DISTRIBUTION_REVIEWED` to `true` only after reviewing
third-party distribution terms in `THIRD_PARTY.md`. The release workflow also
requires this approval; changing Fuse's own license does not relicense dependencies.
Configure its secrets through GitHub's UI (never commit certificates or passwords):

| Secret | Purpose |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Base64 Developer ID Application certificate/P12 and password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Apple notarization credentials |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows signing PFX and password |

Windows signing providers that require a hardware token or cloud signing service
need their signing integration instead of the PFX route. Release builds fail if the
required signing credentials are missing; unsigned main-branch CI artifacts are for testing only.

To release, update the version with `npm version patch --no-git-tag-version` (or
`minor`/`major`) in a pull request. Once it passes CI and is merged, tag the reviewed
main commit `vX.Y.Z` and push that tag. CI tests all three
platforms and builds signed macOS universal, Windows x64, and Linux x64 installers.
Only after every build succeeds does it create a **draft** GitHub Release containing
installers, blockmaps, and `latest*.yml` update metadata. Test the installers and a
previous-version-to-new-version update before publishing the draft as the latest
stable release. Never publish a partial set of assets or overwrite a released version.
Attach the corresponding source, dependency notices, and build instructions for
each binary release; the source archive is created by the workflow.

Publishing the draft enables update discovery. To withdraw a bad release, remove it
from distribution and ship a higher-version fix; clients do not downgrade automatically.
Keep the app ID and signing identities stable across versions.

## Run from source

```bash
npm ci
npm run dev        # Electron with hot reload (Vite serves the renderer, /api is proxied)
```

Other scripts:

| Script                                         | What it does                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`                            | Type-checks the main, preload, shared and renderer code             |
| `npm run lint`                                 | ESLint                                                              |
| `npm test`                                     | Vitest (main-process services and routes in Node, renderer in jsdom) |
| `npm run build`                                | Bundles main, preload, the MCP server, the headless entry and the renderer into `out/` |
| `npm run preview`                              | Runs the bundled app                                                |
| `npm run dist`                                 | Builds installers for the current platform into `release/`          |
| `npm run dist:mac` / `dist:win` / `dist:linux` | Platform-specific installers                                        |

`FUSE_SCREENSHOT=/tmp/fuse.png npm run preview` renders the window, writes a PNG of it, and
quits. That is how CI smoke-tests the bundle on a headless machine.

Live checks against the real tools are opt-in because they spend API credits or need a
toolchain:

```bash
FUSE_LIVE_CLI=1 npx vitest run tests/main/agents/live-cli.test.ts
FUSE_LIVE_LEAN=1 npx vitest run tests/main/services/lean/lean.live.test.ts
```

### Headless backend

The backend also runs without Electron, for integration tests, screenshot runs and driving the
API with curl:

```bash
npm run build
node out/main/standalone.js --data /tmp/fuse-data --port 0 --register /path/to/repository
```

It prints one JSON line, `{"baseUrl", "token", "entryUrl"}`. Call `/api` with
`Authorization: Bearer <token>`; open `entryUrl` in a browser to get the UI (it exchanges the
token for the session cookie). `--renderer none` skips the static renderer, `--token` fixes
the token, `--port` fixes the port. `SIGINT`/`SIGTERM` end live sessions, stop Lean and exit.

## How it works

```
src/
├── main/                    Electron main process
│   ├── index.ts             Window, session cookie, menu, IPC, orderly quit
│   ├── standalone.ts        The same backend without Electron (see above)
│   ├── server/              Loopback Hono app: auth, error envelope, SSE rooms, static renderer
│   │   └── routes/          /api/{auth,repositories,sessions,internal,...}: the web's routes
│   ├── services/            The web backend's slices, re-implemented locally (see services/README.md)
│   │   ├── blueprint*/      LaTeX blueprint parser, dependency graph, declaration model
│   │   ├── lean/            lake build, lake serve (LSP) per project, build snapshots, Loogle
│   │   │   ├── build/      Build execution, events, snapshots and stamps
│   │   │   └── lsp/        Language-server client, protocol, transport and diagnostics
│   │   ├── git/             status, diffs, commits, history, branch sync
│   │   ├── workspace/       Workspace creation, Lean project scaffolding, deletion
│   │   ├── sources/         Uploaded/imported sources and their artifacts
│   │   └── sessions/        Agent sessions: prompts, launch, transcripts, permissions, SSE
│   ├── agents/              One adapter per CLI, translating its JSON stream into AgentEvent
│   │   ├── claude-code/     Claude adapter, event translation, permissions, process and options
│   │   └── codex.ts         Codex adapter; shared transport utilities stay in agents/
│   ├── store/               JSON registries (repositories, blueprints, sources, conversations)
│   ├── paths.ts             Where everything lives under the user-data directory
│   ├── attention.ts         Notifications, badge, power-save blocker
│   └── menu.ts              Application menu and context menu
├── mcp/                     The `fuse` MCP server the CLIs connect to (stdio; a thin HTTP client of /api)
├── preload/                 Exposes `window.fuse` to the renderer over IPC
├── shared/                  Types shared by both sides: API payloads, AgentEvent, the bridge
└── renderer/                The Fuse web frontend (React, Vite, Tailwind v4, CodeMirror, KaTeX)
    └── src/desktop/         The only desktop-specific UI: menu commands, settings sections, drag-and-drop
resources/prompts/           System prompts and the Claude Code plugin (subagent roles) for a workspace
fixtures/sample-blueprint/   A small Lean + blueprint project used by the tests
tests/                      Mirrors src/ (renderer/src maps to tests/renderer)
scripts/                    Structural checks and test inventory
```

Related route handlers live in `main/server/routes/internal/`. Chat components are grouped
under `features/chat/components/composer/`, `panel/`, and `subagents/`; blueprint components
use their existing mode directories. See [CONTRIBUTING.md](../CONTRIBUTING.md) for organization,
documentation, and testing conventions.

Session internals are grouped into `services/sessions/{service,session,transcript}/`.
Blueprint hooks keep each hook and its collaborators together under `hooks/{events,
card-positioning,chapter,infoview,latex-parser,new-blueprint-form}/`; chat hooks use
`hooks/{chat-turns,transcript-scroll}/`, with transcript hydration under `state/history/`.

**Loopback backend.** The main process starts a Hono server on `127.0.0.1` with a random port
and a per-launch token. The window's origin gets an `HttpOnly` session cookie for that token
before the app loads, so the frontend's relative fetches, EventSource streams and uploads work
exactly as against the hosted backend; other clients (the MCP server, the headless harness)
send the token as a bearer. Unknown `/api` paths return the web's JSON error envelope; static
responses carry the hosted app's Content-Security-Policy.

**Agent sessions.** A chat session launches `claude` (stream-json over stdio, permission prompts
answered from the UI) or `codex exec --json` in the repository folder, with the adapted system
prompt and the `fuse` MCP server configured. The MCP tools (declaration model, Lean goals and
diagnostics, builds) call `/api/internal/*` on the loopback server. Turn progress streams to
the UI as server-sent events with the web's ids, replay and heartbeat semantics; transcripts
are persisted in the web's message format so history renders identically. Claude Code's own
`Task` subagents appear nested under the call that spawned them.

**Lean.** One `lake serve` per open project, started on demand and idle-stopped, serves goals,
hover and diagnostics for the editors and the agent. Builds are coalesced per project and
their status is published to the blueprint's event stream; error counts are kept in
`.lake/.build-errors.json` alongside the build stamp.

## What differs from the web app

The desktop is a single local user, so the following are intentionally absent or different:

- No sign-in, admin, billing, usage, access tokens, feedback or share links.
- Repositories are local folders you open (drag one onto the window, or **File > Open
  Repository**); there is no GitHub app, cloning or repository cache.
- A workspace runs in your folder on its current branch: no worktrees, no `numina/<id>` branches,
  no pull requests. Sync and push are available when the folder has an `origin` remote.
- No OCR for PDF sources.
- No collaboration websocket: edit mode saves through the REST autosave path.
- Claude Code and Codex replace the hosted agent harness and Fuse's MCP child-agent servers;
  their permission prompts are shown in the chat.

## Desktop behaviour

- **Finding the CLIs and Lean.** On macOS and Linux the app asks your login shell for its `PATH`
  at startup, so tools installed through Homebrew, nvm, pnpm, elan or `~/.local/bin` are found
  even when Fuse is launched from the Dock or a launcher. On Windows the npm `.cmd` shims are
  launched through the shell; prompts travel over stdin, never the command line.
- **Shortcuts.** `Cmd/Ctrl+N` new workspace, `Cmd/Ctrl+O` open repository,
  `Cmd+,` / `Ctrl+,` settings, `Cmd/Ctrl+Shift+H` dashboard, `Cmd/Ctrl+Shift+L` chats,
  `Cmd/Ctrl+Shift+S` active sessions, `Cmd/Ctrl+L` focus the composer, `Cmd/Ctrl+.` stop the
  turn, `Cmd/Ctrl+Shift+T` toggle the theme, plus the usual edit, zoom and window roles and
  **Help > Guide**. Right-click gives cut/copy/paste, spelling suggestions and link actions.
- **Drag and drop.** Drop a folder anywhere on the window to open it as a repository.
- **Attention.** When the window is in the background, a finished or failed turn and any
  permission prompt raise a native notification and a dock/taskbar badge; clicking the
  notification opens that conversation (creating the window if it was closed). The machine is
  kept awake while a turn runs.
- **Window.** Single instance (a second launch focuses the running app), remembered size,
  position and last route, native theme follows the app theme, links open in your browser.
- **Quitting.** Live sessions are interrupted and closed as completed, Lean servers are stopped
  and the server is shut down before the process exits (bounded, so a stuck tool cannot hang
  the quit).

## Where data lives

Everything Fuse keeps is under Electron's user-data directory (`~/Library/Application
Support/Fuse` on macOS, `%APPDATA%/Fuse` on Windows, `~/.config/Fuse` on Linux); repositories
stay where you have them.

```
settings.json                theme, CLI paths, agent defaults, display name, last route
window-state.json
data/
  repositories.json          registry of opened folders
  repositories/<id>/
    blueprints.json          workspaces of that repository
    blueprints/<name>/model.json   declaration model (agent-owned fields)
    sources.json
    sources/<uuid>/          uploaded originals and derived artifacts
  conversations.json         conversation index
  conversations/<id>.json    transcript and job metadata
  prompts/<conversation>/    the rendered system prompt handed to the CLI
```

The CLIs keep their own session state where they always have.

## Provenance

The frontend is the Numina Fuse web application's; the backend services under
`src/main/services` re-implement its Python backend slices (blueprint parser and model, Lean
build and LSP, git, workspaces, sources, sessions) for one local user, and
`resources/prompts` adapts its agent prompts to the CLIs. `src/shared/api-types.ts` and
`src/main/services/README.md` pin the contracts between the two.

## License

AGPL-3.0-or-later. See [LICENSE](../LICENSE) and [THIRD_PARTY.md](../THIRD_PARTY.md).
