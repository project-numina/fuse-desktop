# Contributing to Fuse Desktop

This file records Fuse's TypeScript, Electron, and testing conventions. Contributions
are submitted under AGPL-3.0-or-later unless explicitly stated otherwise.

See the [developer reference](docs/development.md) for architecture, local setup,
and release instructions.

## Before opening a pull request

Run the checks that match the change:

```bash
npm run typecheck
npm run lint
npm run check:structure
npm test
npm run build
```

Use `npm run test:coverage` when behavior changes and `npm run test:inventory` when adding or moving source files.

## Code organization

- Group a feature's implementation files in a named directory once it has several collaborators (for example, `main/agents/claude-code/` and chat `components/composer/`). Keep shared utilities at their common parent; avoid generic helper directories and one-file folders.
- Move mirrored tests and update consumers together with source moves. Use a directory entry point only for a cohesive public API; do not create barrels solely to hide the layout.
- Keep production source files near 500 lines of code or fewer. This is a soft limit, not a reason to split cohesive code into arbitrary fragments. Generated files, declarative data, and test fixtures may be exceptions.
- Keep function and method bodies near 40 lines or fewer, excluding documentation. Extract a named helper when a block performs a distinct operation or requires a separate explanation.
- Treat these limits as review signals. Existing oversized code should not block an unrelated change, but touched code should not make the problem worse. Prefer a focused follow-up refactor over an unsafe rewrite mixed into a feature.
- `npm run check:structure` rejects unapproved file-size regressions and reports long functions for review. Narrow exceptions must be recorded in the checker with a capped allowance and a clear architectural reason.
- Keep Electron main-process, preload, shared, and renderer responsibilities separated. Renderer code must use the preload bridge rather than importing Node or Electron APIs directly.
- Extract reusable stateful renderer logic into hooks or state modules and complex pure logic into `lib` modules.

## Documentation

Write self-documenting code first. Add documentation where it explains intent, invariants, lifecycle, side effects, ownership, or failure behavior that the signature and names do not make clear.

- Use concise JSDoc for exported APIs and non-obvious functions, hooks, classes, and types.
- Follow Google-style principles: begin with a short summary, add a paragraph only when context is necessary, and document parameters, return values, or thrown errors only when they are not evident from the TypeScript types and names.
- Do not add comments that merely restate the implementation, document every local variable, or repeat type information.
- Use inline comments sparingly for subtle ordering, protocol, compatibility, or performance constraints.
- Record architectural decisions in documentation rather than embedding long design essays in source files.

Example:

```ts
/**
 * Restores a window rectangle while keeping it visible on a connected display.
 *
 * Falls back to the platform default when persisted bounds are invalid or no
 * longer intersect an available display.
 */
function restoreWindowBounds(savedBounds: WindowBounds | null): WindowBounds | undefined {
  // ...
}
```

## Tests

- Keep tests under `tests/`, mirroring the production source tree.
- Test observable behavior, important failure paths, cleanup, and boundary conditions. Avoid tests that only prove an export exists or reproduce implementation details.
- A source file does not require a dedicated test file when its behavior is already exercised clearly by a cohesive domain or integration suite. Type-only modules and barrel exports are normally exempt.
- New executable behavior must receive coverage. Coverage percentages are a regression signal, not a substitute for meaningful assertions.
- Do not use real network services, user credentials, or paid agent calls in the default suite. Mark live checks as opt-in.

## Refactoring oversized code

When changing a file above the soft limit:

1. Keep the functional change focused and covered by tests.
2. Identify cohesive seams such as parsing, persistence, protocol handling, view state, or rendering.
3. Extract one seam at a time with no behavioral change.
4. Avoid circular dependencies and catch-all `utils` modules.
5. Verify typecheck, lint, tests, and the production build after each extraction.
