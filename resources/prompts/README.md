# Agent prompts

Everything the app tells the Claude Code / Codex CLIs about a blueprint
workspace, adapted from the Fuse web backend's prompts for a single local
agent with native tools plus the `fuse` MCP server (`out/main/mcp-server.js`).

```
prompts/
├── system-prompt.md          orchestrator system prompt for Claude Code (native Task subagents)
├── system-prompt-codex.md    the same for Codex, no subagents: the role protocols are inlined
└── blueprint/                Claude Code plugin loaded with --plugin-dir
    ├── .claude-plugin/plugin.json   manifest (name "fuse"; required by claude 2.1.270)
    ├── CLAUDE.md             project context, appended to the rendered system prompt (see below)
    └── agents/*.md           one subagent per role, registered as fuse:<role>
```

## Placeholders

Both system prompts carry `{braces}` placeholders the sessions module fills at
launch (plain text substitution; the values are paths and names, never
prompt text):

| placeholder | value |
| --- | --- |
| `{repo_root}` | absolute path of the repository folder (`OpenProject.clonePath`); this is the CLI's working directory (`ThreadLaunch.repoPath`) |
| `{project_root}` | absolute path of the Lean project root (`OpenProject.projectRoot`, where `lake` runs and `.lake/*` lives) |
| `{project_subdir}` | repository-relative Lean project directory, `.` for a root project (unused by the shipped prompts) |
| `{blueprint_tex}` | absolute path of the blueprint entrypoint `.tex` |
| `{blueprint_name}` | the blueprint id (`BlueprintRow.id`) |
| `{lean_module}` | the first `lean_lib` of the project's lakefile (`inferLeanModule`), or `(not recorded yet; read it from the lakefile)`; the prompts tell the model to put new Lean files under it |

Unlike the web (whose sandbox runs in the Lean project root with the whole
repository at `/workspace`), the desktop CLI runs in the repository root so
the blueprint and a nested Lean project are both under its cwd; the prompts
say so and tell the model to run `lake`/`lean` in `{project_root}`. The
`fuse` Lean tools keep the web convention: a relative `file_path` is
project-relative (absolute paths work everywhere).

The per-turn preamble (repository/environment status, control block,
attachments) is not part of these files; the sessions module prepends it to
each user message exactly as the web does.

## Tool names

The MCP server registers as `fuse`, so every tool is `mcp__fuse__<name>`:
`lean_goal`, `lean_term_goal`, `lean_hover`, `lean_diagnostic_messages`,
`lean_reload_file`, `lean_loogle`, `lean_build`, `get_build_status`,
`get_build_errors`, `blueprint_get_summary`, `blueprint_list_declarations`,
`blueprint_read_declarations`, `blueprint_update_declarations`,
`blueprint_set_declaration_status`, `blueprint_validate`, `blueprint_refresh`.
The role files' `tools:` frontmatter only names these and Claude Code's
built-in tools, so a subagent never silently loses a tool.

Changes from the web prompts (per the port spec's desktop recommendations):
`build_project` / `build_module` / `get_build_warnings` became `lean_build(target?)`
and `get_build_errors(include_warnings?)`; `initialize_blueprint_metadata` is
gone (the app creates the blueprint record; after writing a brand-new `.tex`
call `blueprint_refresh`); `refresh_blueprint_metadata` is `blueprint_refresh`;
`measure_heartbeats` is replaced in the golfer by the `lake env lean ... -Dtrace.profiler=true`
command run through Bash; `source-tools`, `repo-git`, `authoring-tools`,
`orchestration-tools`, `prover-tools`, `report-misuse` and `lean-explore` have no
desktop equivalent (attached sources are read with `Read`; Mathlib is searched
with `lean_loogle`, `Grep` over `.lake/packages/mathlib` and `lean_hover`).
Reviewers answer with a `VERDICT: PASS|FAIL` + `FEEDBACK:` block instead of the
web's review-token submission; the blueprint writer aborts with `VERDICT: ABORT`.
The `merger` role (cross-branch merges through `repo-git`) is dropped. The
"Fuse commits for you" rule became "do not commit unless the user asks".

## Claude Code wiring (as `sessions/launch.ts` + `agents/claude-code.ts` build it; flags verified against claude 2.1.270)

```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
  --permission-prompt-tool stdio --permission-mode <acceptEdits|auto|bypassPermissions|...>   # from the workspace agent settings
  [--dangerously-skip-permissions]                                      # only with bypassPermissions
  --system-prompt-file <appdata>/prompts/<conversation>/system.md      # rendered system-prompt.md + blueprint/CLAUDE.md (replace semantics, like the web)
  --plugin-dir <resources>/prompts/blueprint                            # agents register as fuse:<role>
  --mcp-config '{"mcpServers":{"fuse":{...}}}' --strict-mcp-config      # inline JSON, no mcp.json file is written
  [--add-dir <repoRoot>]                                                # launch.ts adds it when project_subdir is set; redundant with cwd = <repoRoot>
  --allowedTools mcp__fuse Task --disallowedTools ScheduleWakeup CronCreate CronList CronDelete AskUserQuestion
  --max-turns 200 [--model <model>] [--effort <level>] [--resume <session id>]
cwd: <repoRoot>    env: FUSE_* (see src/mcp/env.ts) + MCP_TOOL_TIMEOUT=600000
```

Facts checked with the installed CLI:

- `--system-prompt-file` and `--append-system-prompt-file` are accepted
  (hidden from `--help`, but listed under `--bare`; a missing file fails fast
  with `Error: System prompt file not found`). `--system-prompt <text>` works
  too; keep inline text under 32 KB on Windows, which is why the ~30 KB prompt
  travels through the file.
- `--system-prompt-snapshot on` (the default) records the system prompt on a
  conversation's first request and reuses it on every `--resume`; a changed
  prompt only applies to a new conversation.
- `--plugin-dir <dir>` requires `.claude-plugin/plugin.json`; without it the
  directory is rejected (`No manifest found in directory`). With the manifest
  the eight roles appear in the session's agent list as `fuse:blueprint`,
  `fuse:blueprint-reviewer`, `fuse:explorer`, `fuse:formalizer`,
  `fuse:formalizer-reviewer`, `fuse:golfer`, `fuse:prover`, `fuse:prover-reviewer`;
  the prompts use those exact `subagent_type` values.
- A `CLAUDE.md` at the plugin root is **not** loaded as project context by
  `--plugin-dir` (`claude plugin validate` warns about it). The sessions
  module therefore appends `blueprint/CLAUDE.md` to the rendered system
  prompt (`prompts.ts`, `renderSystemPrompt`) for both providers; it reaches
  the orchestrator, and the role files under `agents/` carry their own
  instructions. Subagents cannot spawn subagents, so the role files search
  Mathlib themselves instead of calling the explorer.
- `--mcp-config` accepts the configuration inline as a JSON string (a file
  path works too). The `fuse` entry is `stdio` with `command` = the Electron
  binary, `args` `[<out>/main/mcp-server.js]` and `env`
  `{ELECTRON_RUN_AS_NODE: "1", FUSE_API_URL, FUSE_API_TOKEN, FUSE_OWNER,
  FUSE_REPO, FUSE_BLUEPRINT, FUSE_REPO_PATH, FUSE_PROJECT_ROOT,
  FUSE_CONVERSATION_ID}`; with `--strict-mcp-config` it connects
  (`mcp_servers: [{name: "fuse", status: "connected"}]`) and exposes all
  sixteen `mcp__fuse__*` tools.
- `--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`,
  `manual`, `dontAsk`, `plan` (`default` is no longer a value).
- `claude plugin validate <dir>` checks the manifest offline; it does not
  validate `agents/*.md`, so a frontmatter typo only shows up in the session's
  agent list.

## Codex wiring

`system-prompt-codex.md` is prepended to the first turn of a `codex exec`
thread inside a delimited block (exec mode has no developer-instructions
channel); the MCP server is configured with
`-c mcp_servers.fuse.command=<electron> -c mcp_servers.fuse.args=[<mcp-bootstrap.cjs>]`
where the bootstrap file, written per conversation under the app's data
directory with owner-only permissions, carries the `FUSE_*` environment so the
API token never appears on a command line. Its tools are also named
`mcp__fuse__<name>`. The CLI runs with
`-C <repoRoot>` and, outside `danger-full-access`, `-c approval_policy="never"`:
under that policy Codex refuses any MCP tool whose annotations leave
`destructiveHint` at its default (true), so every `fuse` tool declares either
`readOnlyHint: true` or `destructiveHint: false` (`tests/mcp/tools.test.ts`
checks this).
