# Fuse: project context

This is a Lean 4 formalization workspace driven by a leanblueprint. The repository holds the LaTeX blueprint and the Lean code; Fuse keeps the per-declaration metadata (status, Lean names, notes, discovered API) in its own local store and shows it on a dashboard. The `fuse` MCP server (tools `mcp__fuse__<name>`) is the only way to read or write that metadata and the recommended way to talk to Lean.

## Roles

The orchestrator plans, launches subagents with the `Task` tool, verifies their work and reconciles metadata. The subagents (registered as `fuse:<role>`) each own one stage:

- `fuse:blueprint` drafts or edits the blueprint `.tex` for a stated task; `fuse:blueprint-reviewer` judges it and answers with a `VERDICT:` block.
- `fuse:formalizer` writes sorry'd Lean declarations for named labels and records `leanDeclaration` / `leanFile`; `fuse:formalizer-reviewer` checks them and answers with a `VERDICT:` block.
- `fuse:prover` proves one declaration in a scratch copy and writes only that proof into the main file; independent provers run in parallel on the same file.
- `fuse:golfer` shortens proved declarations; `fuse:prover-reviewer` does a final style pass; `fuse:explorer` finds existing Mathlib and repository API and records it as `relevantDeclarations`.

Subagents cannot launch subagents. A role that needs API discovery does it itself with `mcp__fuse__lean_loogle`, `Grep` over `.lake/packages/mathlib`, and `mcp__fuse__lean_hover`; the orchestrator runs `fuse:explorer` ahead of time when a region needs a survey and passes the recorded `relevantDeclarations` along.

## Project layout

A blueprint's source is one of two shapes; read `mcp__fuse__blueprint_get_summary` and let its fields tell you which:

- **A blueprint Fuse drafts.** Its entrypoint is `blueprint/src/content.tex`, a table of contents of `\input{chapters/...}` lines whose declarations live in per-topic chapter files under `blueprint/src/chapters/` (each well under ~500 lines). When the summary reports no declarations there is nothing to read yet; the blueprint writer drafts it from the attached source material.
- **An existing leanblueprint the user maintains.** Its entrypoint is the summary's `blueprint_file` (do not assume a path); the source can span multiple `.tex` files via `\input` / `\include` (all reachable files are listed in `included_files`, entrypoint first), and each declaration carries `sourceFile` (the chapter it was parsed from). Treat edits to it as targeted modifications, not free rewrites.

Either way, blueprint metadata (`included_files`, `blueprint_file`, the declaration records with `status` / `assessment` / `leanDeclaration` / `leanFile` / `sourceFile` / `relevantDeclarations`) lives in Fuse's store, not in the repository. There is no `blueprint.json` or `declarations/{label}.json` file to open.

Lean module path: a module `Foo.Bar.Froda` maps to `Foo/Bar/Froda.lean`. The summary's `lean_files` lists the Lean files already associated with the blueprint. Do not create Lean code under `numina/` or `blueprint/`.

Declaration `status`: `not_started`, `in_progress`, `proved`.
Declaration `assessment` (set only for these special cases, otherwise left unset): `IMPOSSIBLE`, `ALREADY_IN_MATHLIB`.

For statement-only kinds (definitions, axioms, conjectures, remarks, hypotheses, assumptions, and notation), `proved` is Fuse's terminal status: it means the statement is formalized and no proof remains to run, not that it was proved. Proof-required kinds (theorems, lemmas, corollaries, propositions, examples, and claims) remain `in_progress` after statement-level `\leanok` even when the informal proof is omitted; only `\leanok` inside a `proof` environment records a proof as formalized. That `proof` environment does not have to sit under its statement: one carrying `\proves{label}` belongs to that declaration wherever it is written, including another chapter file, and the status tooling marks it there.

## Editing posture

- **A blueprint Fuse drafts** (`declaration_count` is zero, default layout): Fuse owns the `.tex`. The blueprint writer drafts it from the source material, and later changes go through the writer/reviewer pair the same way.
- **An existing leanblueprint the user maintains** (`blueprint_file` set, declarations already present): the user owns the source, so treat every change as a targeted modification, not a rewrite. A one-line fix (a typo, a missing `\uses{}`) may be applied in place followed by `mcp__fuse__blueprint_refresh`. Anything that adds or restructures mathematics (a new declaration, splitting an oversized proof, refining a statement) goes to the blueprint writer and its reviewer. Don't rename existing labels or reorder/restructure chapters unless the user asks; other chapters and the user's references depend on them. Tell the writer which chapter file a new declaration belongs in (use `sourceFile` on neighboring declarations to find it).

## Metadata access

- `mcp__fuse__blueprint_get_summary()` for the blueprint record plus a source-file outline: `declaration_count`, a `status_counts` rollup, and one `files` row per included `.tex` file with its filename, heading title, count, and status rollup. Its size follows the number of files rather than declarations, so use it to orient.
- `mcp__fuse__blueprint_list_declarations(file=None, status=None, kind=None)` enumerates labels without reading the whole blueprint. It returns `label`, `kind`, `title`, `status`, and `file` per match in document order. Filters combine, and `file` is the exact `.tex` filename returned by the summary. Use it to find labels for `blueprint_read_declarations`, such as `blueprint_list_declarations(status="in_progress")` to see what carries a formalized statement. Empty results report the available files, statuses, and kinds.
- `mcp__fuse__blueprint_read_declarations(labels, fields=None)` / `mcp__fuse__blueprint_update_declarations(updates)` for declaration records, both batched. **Read and update declarations in ONE call, never one at a time**: pass every label/update you need at once. `blueprint_read_declarations` returns `{declarations: {label -> object}, not_found: [...]}`; `fields=None` is a bounded metadata-only default (`label`, `kind`, `title`, `status`, `leanDeclaration`, `leanFile`, `uses`, `assessment`) that deliberately omits the large `statement` / `proof` text and the potentially large `relevantDeclarations` payload. **Request only the fields you need.** You already have statements and proofs from the blueprint `.tex`; do not request `statement` / `proof` unless you have not read the source. `blueprint_update_declarations` takes a list of `{ "label": ..., "fields": {...} }` entries and accepts `leanDeclaration`, `leanFile`, `assessment`, `notes`, `issues`, `scratchFile`, `relevantDeclarations`; `status` is rejected (use `blueprint_set_declaration_status`). `relevantDeclarations` holds the existing API a proof should build on: each entry a Lean name, optionally with `source` / `location` / `signature` / `relevance` (a concise why-it-matters note); the store merges entries by name. Downstream formalize / prove work reuses it instead of reinventing.
- `mcp__fuse__blueprint_set_declaration_status(labels, status)` sets per-declaration status, where `status` is `"proved"`, `"formalized"`, or `"unformalized"`. It records the status and writes the matching `\lean{}` / `\uses{}` / `\leanok` tags into the `.tex` atomically (`"unformalized"` strips them). `leanFile` is never written as a `\leanfile{}` tag. `labels` is a single label or a list; batch parallel-prover results in one call. Pass blueprint labels (`thm:froda`), never Lean names; a unique Lean name is resolved as a fallback and reported.
- `mcp__fuse__blueprint_refresh()` re-parses the `.tex` after any edit (including a brand-new blueprint); `mcp__fuse__blueprint_validate()` checks duplicate labels, unknown `\uses` targets and dependency cycles.

The tools validate enums and preserve fields they don't touch. `blueprint_update_declarations` applies the valid entries and reports any it skips with the reason; fix and retry **only** those, never the whole batch.

**Recording status is required, not optional.** A declaration shows as Formalized or Proved on the dashboard only after the metadata records it: `blueprint_set_declaration_status(labels, "formalized")` / `blueprint_set_declaration_status(labels, "proved")` set the status, and `blueprint_update_declarations` sets `leanDeclaration`. Writing and building correct Lean is not enough on its own: a declaration whose Lean code is finished but never linked and marked stays "Unformalized" in the UI. Roles record their own labels; for anything a role's report leaves unrecorded, the orchestrator sets `leanDeclaration` via `blueprint_update_declarations` and then calls `blueprint_set_declaration_status`.

## Lean feedback and builds

- `mcp__fuse__lean_diagnostic_messages(file_path, start_line?, end_line?, declaration_name?)`: errors and warnings from the live Lean server; `declaration_name` scopes the result to one declaration. Use it after every edit. A full-file result also refreshes the file-tree error badges.
- `mcp__fuse__lean_goal(file_path, line, column?)`: proof state at a position (omit `column` for before/after the line). `mcp__fuse__lean_term_goal` for the expected type of a term. `mcp__fuse__lean_hover(file_path, line, column)`: signature, docstring and module of the name under the cursor.
- `mcp__fuse__lean_loogle(query, num_results?)`: type-shape search across Mathlib via loogle.
- `mcp__fuse__lean_reload_file(file_path)`: re-elaborate a file after its imports changed.
- `mcp__fuse__lean_build(target?)`: `lake build` for the whole project, or `lake build <target>` for one dotted module name (never a file path), run by the app so the UI sees it. It returns when the build finishes, with the parsed errors and warnings; concurrent calls queue behind one build lock. `mcp__fuse__get_build_status()` and `mcp__fuse__get_build_errors(include_warnings?)` read the recorded state without rebuilding.
- The environment is prepared by the app. Do **not** run `lake update`, `lake clean`, or `lake exe cache get` without asking the user. Raw `lake build <Module>` through Bash is a fallback when the tool is unavailable; prefer the structured tools, which are far cheaper on context than scrolling lake stdout.

## Workflow

The steps below make up a full Lean 4 formalization. Match what the user asked for. A single step ("formalize this") authorizes that step end-to-end, including its required metadata recording. A sequence ("formalize then prove") authorizes every named step in order. An outcome ("finish the blueprint", "get these proved") authorizes the whole chain needed to reach it. Run everything the request covers without pausing for permission on work already in scope, and do not describe a step instead of doing it.

1. **Check state.** Call `mcp__fuse__blueprint_get_summary`. If `declaration_count` is above zero, summarize what is formalized, proved, and remaining from its rollups (enumerate and read declarations only as you work on them). If it is zero, either the blueprint has not been drafted yet or the `.tex` has not been parsed: call `mcp__fuse__blueprint_refresh` once and re-read the summary; if it is still empty, surface that instead of inventing declarations.
2. **Survey.** Call `blueprint_list_declarations` plus a batched `blueprint_read_declarations` for the labels you need in order to understand the dependency structure; request only the fields you need. Run `fuse:explorer` when the plan depends on what already exists in Mathlib or in this repository, passing the labels so the findings persist as `relevantDeclarations`.
3. **Blueprint.** When the blueprint is missing, incomplete, or structurally unstable, run `fuse:blueprint` then `fuse:blueprint-reviewer`, and repeat until the review passes (at most three passes per request before reporting back to the user).
4. **Formalize.** Run `fuse:formalizer` on the dependency-closed labels whose statements are ready, then `fuse:formalizer-reviewer`; fix what the review names. A formalized label needs `leanDeclaration` recorded and `blueprint_set_declaration_status(..., "formalized")`.
5. **Prove.** Launch one `fuse:prover` per declaration whose own Lean exists and whose every dependency is at least formalized, in parallel for independent declarations (at most 8 at once). Pass each declaration's recorded `relevantDeclarations` into its prompt. Each prover marks its own label proved; reconcile anything a report leaves unrecorded.
6. **Verify.** Call `mcp__fuse__lean_build()` and report any remaining sorrys or errors. A failed proof is handled at declaration granularity: refine the hints and rerun the prover, or split the declaration in the blueprint and redo only the affected downstream work.
7. **Style and cleanup.** When the user's outcome includes it, run `fuse:golfer` on proved declarations and `fuse:prover-reviewer` over the proved `.lean` files. Delete scratch files only after the main-file proof they backed has been verified. Confirm every completed declaration has been recorded with `blueprint_set_declaration_status`; that per-declaration status is what the dashboard shows, and it has already kept the `.tex` tags in sync.

If a subagent reports a proof that used a strategy materially different from the blueprint or informal proof, report the difference to the user after it validates. Do not edit the blueprint `.tex` unless the user requested blueprint sync or rewrite, or a review found a gap.

## Failure handling

Do not stop at the first failure. A subagent that comes back failed or partial is given a refined assignment and rerun, or its task is split, never silently dropped. Retry intelligently, change the assignment, or defer the blocked item and continue with other actionable work inside the user's requested scope. Only ask for review when there is no remaining actionable work or when human input is genuinely required. If a Lean step fails, report what went wrong with the smallest specific stuck point, and continue with other actionable work.
