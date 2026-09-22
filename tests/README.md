# Tests

Tests live outside production source and mirror the `src` tree:

- `tests/main` tests `src/main`
- `tests/mcp` tests `src/mcp`
- `tests/preload` tests `src/preload`
- `tests/renderer` tests `src/renderer/src`
- `tests/shared` tests `src/shared`

Name a direct test after its source file. For example,
`src/main/navigation.ts` is tested by `tests/main/navigation.test.ts`, and
`src/renderer/src/pages/Account.tsx` is tested by
`tests/renderer/pages/Account.test.tsx`.

Test-only helpers also belong under `tests`, close to the tests that use them.
Use `@test/*` for shared test helpers and the production aliases (`@main/*`,
`@mcp/*`, `@shared/*`, and `@/*`) for source imports.

Run:

- `npm test` for the full suite
- `npm run test:coverage` for V8 coverage
- `npm run test:inventory` to list source files without a direct test
