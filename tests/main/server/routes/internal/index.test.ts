import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlueprintBuildStatus, BlueprintResponse, BuildErrorCounts, BuildSnapshotEvent } from '@shared/api-types';
import type { OpenProject } from '@main/services/types';
import type { AppContext } from '@main/server/context';
import { errorResponse, HttpError } from '@main/server/errors';
import { internalRoutes, normalizeBuildOutcome, resolveDeclarationByLeanName, validateDeclarationFields, type InternalPorts } from '@main/server/routes/internal';

// ── Fixture: the sample blueprint's declarations as declarationToJson rows ──

const DOUBLING = 'blueprint/src/chapters/doubling.tex';
const SQUARES = 'blueprint/src/chapters/squares.tex';
const ENTRY = 'blueprint/src/content.tex';

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    label: '',
    kind: 'theorem',
    title: '',
    leanDeclaration: '',
    leanFile: '',
    uses: [],
    statement: 'S',
    proof: null,
    sourceFile: DOUBLING,
    proofSourceFile: '',
    status: 'not_started',
    assessment: '',
    notes: '',
    issues: [],
    scratchFile: '',
    relevantDeclarations: [],
    ...overrides,
  };
}

function sampleRows(): Record<string, unknown>[] {
  return [
    row({ label: 'def:twice', kind: 'definition', title: 'Doubling', leanDeclaration: 'twice', status: 'proved' }),
    row({ label: 'lem:twice-zero', kind: 'lemma', title: 'Doubling zero', leanDeclaration: 'twice_zero', uses: ['def:twice'], proof: 'Immediate.', status: 'proved' }),
    row({ label: 'thm:twice-eq', kind: 'theorem', title: 'Doubling formula', leanDeclaration: 'Sample.twice_eq', uses: ['def:twice'], proof: 'By definition.', status: 'proved' }),
    row({ label: 'def:square', kind: 'definition', title: 'Square', leanDeclaration: 'square', sourceFile: SQUARES, status: '' }),
    row({ label: 'thm:twice-le-square', kind: 'theorem', title: 'Squares dominate doubles', leanDeclaration: 'twice_le_square', uses: ['def:twice', 'def:square'], proof: 'Multiply.', sourceFile: SQUARES, status: 'in_progress' }),
    row({ label: 'conj:cube', kind: 'conjecture', title: 'Cubes', uses: ['def:square'], sourceFile: SQUARES, status: 'not_started' }),
  ];
}

let tempRoot: string;
let project: OpenProject;

function makeProject(): OpenProject {
  const repository = { id: 1, owner: 'local', name: 'repo', path: tempRoot, description: null, created_at: '', last_activity_at: null };
  const blueprint = {
    id: 'bp',
    repository_id: 1,
    title: 'Sample',
    description: 'A sample',
    area: 'number theory',
    blueprint_file: ENTRY,
    project_subdir: 'lean',
    source_type: 'tex',
    source_id: null,
    pr_mode: 'off' as const,
    auto_commit: false,
    orchestrator_child_concurrency: 1,
    agent: { provider: 'claude' as const, model: '', effort: null, claude_permission_mode: 'acceptEdits' as const, codex_sandbox: 'workspace-write' as const },
    created_at: '',
    updated_at: '',
  };
  return {
    repository,
    blueprint,
    clonePath: tempRoot,
    projectSubdir: 'lean',
    projectRoot: join(tempRoot, 'lean'),
    blueprintFile: ENTRY,
    roomKey: 'local/repo/bp',
  };
}

interface Fakes {
  rows: Record<string, unknown>[];
  blueprints: {
    openProject: ReturnType<typeof vi.fn>;
    getBlueprint: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    listDeclarations: ReturnType<typeof vi.fn>;
    updateDeclaration: ReturnType<typeof vi.fn>;
    setDeclarationStatus: ReturnType<typeof vi.fn>;
  };
  lean: {
    buildStatus: ReturnType<typeof vi.fn>;
    buildSnapshot: ReturnType<typeof vi.fn>;
    errorCounts: ReturnType<typeof vi.fn>;
    startBuild: ReturnType<typeof vi.fn>;
    goals: ReturnType<typeof vi.fn>;
    diagnostics: ReturnType<typeof vi.fn>;
  };
  ports: Partial<InternalPorts>;
}

function makeFakes(): Fakes {
  const rows = sampleRows();
  const detail = {
    included_files: [ENTRY, DOUBLING, SQUARES],
    chapter_titles: { [DOUBLING]: 'Doubling', [SQUARES]: 'Squares' },
    lean_files: ['lean/Sample/Basic.lean', 'lean/Sample/Squares.lean'],
    blueprint_file: ENTRY,
  } as unknown as BlueprintResponse;
  return {
    rows,
    blueprints: {
      openProject: vi.fn((owner: string, repo: string, id: string) => {
        if (owner !== 'local' || repo !== 'repo' || id !== 'bp') throw new HttpError(404, 'Blueprint not found', 'http_404');
        return project;
      }),
      getBlueprint: vi.fn(async () => detail),
      refresh: vi.fn(async () => undefined),
      listDeclarations: vi.fn(async () => rows.map((r) => ({ ...r }))),
      updateDeclaration: vi.fn(async (_p: OpenProject, label: string) => rows.some((r) => r.label === label)),
      setDeclarationStatus: vi.fn(async (_p: OpenProject, label: string) => ({ ok: label !== 'lem:twice-zero', rewritten: [DOUBLING] })),
    },
    lean: {
      buildStatus: vi.fn((): BlueprintBuildStatus => ({ status: 'done', head: 'abc', toolchain_hash: 't', manifest_hash: 'm' })),
      buildSnapshot: vi.fn((): BuildSnapshotEvent | null => ({ status: 'running', steps: [{ phase: 'building', message: 'Building Lean project...' }] })),
      errorCounts: vi.fn((): BuildErrorCounts => ({ 'lean/Sample/Basic.lean': { errors: 2, warnings: 1 }, 'lean/Sample/Squares.lean': { errors: 0, warnings: 3 } })),
      startBuild: vi.fn(async () => 'ok'),
      goals: vi.fn(async () => ({ line_context: '  exact foo _', goals: ['⊢ P'], goals_before: null, goals_after: null, expected_type: null })),
      diagnostics: vi.fn(async () => ({ items: [{ severity: 'warning', message: 'declaration uses sorry', line: 4, column: 1, end_line: null, end_column: null }], complete: true, failed_dependencies: [] })),
    },
    ports: {
      validateBlueprintGraph: vi.fn(() => ({ issues: [], declarationCount: 6, filesChecked: [ENTRY, DOUBLING, SQUARES] })),
      fetch: vi.fn(async () => new Response(JSON.stringify({ hits: [{ name: 'Nat.add_comm', type: 'T', module: 'M' }, { name: 'Nat.mul_comm', type: 'U', module: 'N' }] }))) as unknown as typeof fetch,
    },
  };
}

function makeApp(fakes: Fakes, services: Record<string, unknown> = { blueprints: fakes.blueprints, lean: fakes.lean }): Hono {
  const ctx = { services } as unknown as AppContext;
  const app = new Hono();
  app.onError((error, c) => errorResponse(c, error));
  app.route('/api/internal', internalRoutes(ctx, fakes.ports));
  return app;
}

async function post(app: Hono, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await app.request(`/api/internal${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const BP = '/local/repo/bp';

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'fuse-internal-'));
  mkdirSync(join(tempRoot, 'lean', '.lake'), { recursive: true });
  mkdirSync(join(tempRoot, 'blueprint', 'src'), { recursive: true });
  writeFileSync(join(tempRoot, ENTRY), '\\input{chapters/doubling}\n');
  // The version-2 layout `build-snapshot.ts` writes (diagnostics live under `files`).
  writeFileSync(
    join(tempRoot, 'lean', '.lake', '.build-errors.json'),
    JSON.stringify({
      version: 2,
      updated_at: '2026-01-01T00:00:00.000Z',
      content_hashes: { 'Sample/Basic.lean': 'deadbeef' },
      files: {
        'Sample/Basic.lean': [
          { file: 'Sample/Basic.lean', line: 3, column: 1, severity: 'error', message: 'unknown identifier' },
          { file: 'Sample/Basic.lean', line: 5, column: 1, severity: 'warning', message: 'declaration uses sorry' },
        ],
      },
    }),
  );
  writeFileSync(join(tempRoot, 'lean', '.lake', '.build-stamp.json'), JSON.stringify({ head: 'abc', outcome: 'errors' }));
  project = makeProject();
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let fakes: Fakes;
let app: Hono;

beforeEach(() => {
  fakes = makeFakes();
  app = makeApp(fakes);
});

describe('service and project resolution', () => {
  it('returns 503 while the blueprint service is not registered', async () => {
    const bare = makeApp(fakes, {});
    const { status, json } = await post(bare, `${BP}/blueprint/summary`, {});
    expect(status).toBe(503);
    // The envelope masks 5xx details; the code is what the MCP client can act on.
    expect(json.code).toBe('service_unavailable');
  });

  it('propagates the 404 of an unknown project', async () => {
    const { status, json } = await post(app, '/local/repo/nope/blueprint/summary', {});
    expect(status).toBe(404);
    expect(json.code).toBe('http_404');
  });

  it('rejects malformed JSON bodies', async () => {
    const response = await app.request(`/api/internal${BP}/blueprint/declarations/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    expect(response.status).toBe(400);
  });
});

describe('blueprint summary', () => {
  it('rolls declarations up per file, keeps included files first and adds chapter titles', async () => {
    const { status, json } = await post(app, `${BP}/blueprint/summary`);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      name: 'bp',
      title: 'Sample',
      area: 'number theory',
      project_subdir: 'lean',
      project_root: join(tempRoot, 'lean'),
      blueprint_file: ENTRY,
      included_files: [ENTRY, DOUBLING, SQUARES],
      lean_files: ['lean/Sample/Basic.lean', 'lean/Sample/Squares.lean'],
      declaration_count: 6,
      status_counts: { not_started: 2, in_progress: 1, proved: 3 },
    });
    expect(json.files).toEqual([
      { file: ENTRY, title: '', count: 0, status: { not_started: 0, in_progress: 0, proved: 0 } },
      { file: DOUBLING, title: 'Doubling', count: 3, status: { not_started: 0, in_progress: 0, proved: 3 } },
      { file: SQUARES, title: 'Squares', count: 3, status: { not_started: 2, in_progress: 1, proved: 0 } },
    ]);
  });
});

describe('list declarations', () => {
  it('filters by file (project-relative or repo-relative), status alias and kind', async () => {
    const byFile = await post(app, `${BP}/blueprint/declarations/list`, { file: SQUARES });
    expect((byFile.json.declarations as unknown[]).map((d) => (d as { label: string }).label)).toEqual(['def:square', 'thm:twice-le-square', 'conj:cube']);
    const byStatus = await post(app, `${BP}/blueprint/declarations/list`, { status: 'formalized' });
    expect(byStatus.json.count).toBe(1);
    expect((byStatus.json.declarations as Array<Record<string, unknown>>)[0]).toEqual({ label: 'thm:twice-le-square', kind: 'theorem', title: 'Squares dominate doubles', status: 'in_progress', file: SQUARES });
    const byKind = await post(app, `${BP}/blueprint/declarations/list`, { kind: 'definition', status: 'unformalized' });
    expect((byKind.json.declarations as Array<Record<string, unknown>>).map((d) => d.label)).toEqual(['def:square']);
    expect(byKind.json.available).toBeUndefined();
  });

  it('reports available facets when nothing matches and rejects unknown status filters', async () => {
    const empty = await post(app, `${BP}/blueprint/declarations/list`, { kind: 'corollary' });
    expect(empty.json.count).toBe(0);
    expect(empty.json.available).toEqual({
      files: [DOUBLING, SQUARES],
      statuses: ['in_progress', 'not_started', 'proved'],
      kinds: ['conjecture', 'definition', 'lemma', 'theorem'],
    });
    const invalid = await post(app, `${BP}/blueprint/declarations/list`, { status: 'done' });
    expect(invalid.status).toBe(400);
    expect(invalid.json.detail).toBe("Error: invalid status filter 'done'. Expected one of [\"formalized\",\"in_progress\",\"not_started\",\"proved\",\"unformalized\"].");
  });
});

describe('read declarations', () => {
  it('projects the metadata-only default and resolves Lean names as a fallback', async () => {
    const { json } = await post(app, `${BP}/blueprint/declarations/read`, { labels: ['def:square', 'twice_eq', 'thm:missing'] });
    const declarations = json.declarations as Record<string, Record<string, unknown>>;
    expect(declarations['def:square']).toEqual({ label: 'def:square', kind: 'definition', title: 'Square', status: 'not_started', leanDeclaration: 'square', leanFile: '', uses: [], assessment: '' });
    expect(declarations.twice_eq.label).toBe('thm:twice-eq');
    expect(json.not_found).toEqual(['thm:missing']);
    expect(json.ignored_fields).toBeUndefined();
  });

  it('honours explicit fields and lists unknown ones', async () => {
    const { json } = await post(app, `${BP}/blueprint/declarations/read`, { labels: 'lem:twice-zero', fields: ['statement', 'proof', 'bogus'] });
    expect((json.declarations as Record<string, unknown>)['lem:twice-zero']).toEqual({ statement: 'S', proof: 'Immediate.' });
    expect(json.ignored_fields).toEqual(['bogus']);
  });

  it('rejects unsafe labels', async () => {
    const { status, json } = await post(app, `${BP}/blueprint/declarations/read`, { labels: ['../etc'] });
    expect(status).toBe(400);
    expect(json.detail).toMatch(/invalid declaration label/);
  });
});

describe('update declarations', () => {
  it('applies valid entries and reports the rest with reasons', async () => {
    const { json } = await post(app, `${BP}/blueprint/declarations/update`, {
      updates: [
        { label: 'thm:twice-le-square', fields: { leanDeclaration: 'twice_le_square', relevantDeclarations: [{ name: 'Nat.mul_le_mul', relevance: 'monotone' }, 'Nat.le_refl'] } },
        { label: 'conj:cube', fields: { status: 'proved' } },
        { label: 'def:square', fields: { assessment: 'MAYBE' } },
        { label: 'lem:twice-zero', fields: { issues: 'not a list' } },
        { label: 'thm:nope', fields: { notes: 'x' } },
        { fields: { notes: 'x' } },
      ],
    });
    expect(json.updated).toEqual(['thm:twice-le-square']);
    expect(json.skipped).toEqual([
      "conj:cube (Error: 'status' is not settable via update_declarations. Use set_declaration_status so the status and the .tex tags stay in sync.)",
      "def:square (Error: invalid assessment 'MAYBE'. Expected null or one of [\"ALREADY_IN_MATHLIB\",\"IMPOSSIBLE\"].)",
      "lem:twice-zero (Error: 'issues' must be a list of strings.)",
      'thm:nope (not found; has it been parsed yet?)',
      '{"fields":{"notes":"x"}} (each update needs a \'label\' string)',
    ]);
    // Unknown labels are rejected from the parsed row set before the service is asked.
    expect(fakes.blueprints.updateDeclaration).toHaveBeenCalledTimes(1);
    expect(fakes.blueprints.updateDeclaration.mock.calls[0][1]).toBe('thm:twice-le-square');
  });

  it('turns a service failure into a skipped entry instead of failing the batch', async () => {
    fakes.blueprints.updateDeclaration.mockRejectedValueOnce(new Error('disk full'));
    const { status, json } = await post(app, `${BP}/blueprint/declarations/update`, { updates: [{ label: 'def:twice', fields: { notes: 'n' } }, { label: 'def:square', fields: { notes: 'n' } }] });
    expect(status).toBe(200);
    expect(json.updated).toEqual(['def:square']);
    expect(json.skipped).toEqual(['def:twice (disk full)']);
  });

  it('validates the updates envelope', async () => {
    const { status } = await post(app, `${BP}/blueprint/declarations/update`, { updates: [] });
    expect(status).toBe(400);
  });
});

describe('set declaration status', () => {
  it('normalises formalized statement-only kinds to proved and resolves Lean names', async () => {
    const { json } = await post(app, `${BP}/blueprint/declarations/status`, { labels: ['def:square', 'Sample.twice_eq', 'twice_eq', 'conj:cube', 'thm:ghost'], status: 'formalized' });
    expect(json).toMatchObject({
      blueprint: 'bp',
      target_status: 'in_progress',
      updated: ['def:square', 'thm:twice-eq'],
      normalized: ['def:square'],
      resolutions: ["'Sample.twice_eq' -> 'thm:twice-eq'", "'twice_eq' -> 'thm:twice-eq'"],
      rewritten_files: [DOUBLING],
    });
    expect(json.skipped).toEqual([
      'conj:cube (no leanDeclaration; run formalizer)',
      "thm:ghost (no declaration with this label or Lean name; pass the blueprint \\label value, e.g. 'lem:...')",
    ]);
    expect(fakes.blueprints.setDeclarationStatus.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['def:square', 'proved'],
      ['thm:twice-eq', 'formalized'],
    ]);
  });

  it('reports labels the tag rewriter could not match and unformalizes without a Lean name', async () => {
    const { json } = await post(app, `${BP}/blueprint/declarations/status`, { labels: ['lem:twice-zero', 'conj:cube'], status: 'unformalized' });
    expect(json.updated).toEqual(['conj:cube']);
    expect(json.skipped).toEqual(['lem:twice-zero (label not found in the blueprint .tex; run blueprint_refresh or check the source)']);
    expect(json.target_status).toBe('not_started');
  });

  it("prefers the service's own skip reason when it gives one", async () => {
    fakes.blueprints.setDeclarationStatus
      .mockResolvedValueOnce({ ok: false, rewritten: [], reason: 'def:twice (blueprint .tex not found at blueprint/src/content.tex)' })
      .mockResolvedValueOnce({ ok: false, rewritten: [], reason: 'stale parse' });
    const { json } = await post(app, `${BP}/blueprint/declarations/status`, { labels: ['def:twice', 'def:square'], status: 'proved' });
    expect(json.updated).toEqual([]);
    expect(json.skipped).toEqual(['def:twice (blueprint .tex not found at blueprint/src/content.tex)', 'def:square (stale parse)']);
  });

  it('rejects unknown verbs', async () => {
    const { status, json } = await post(app, `${BP}/blueprint/declarations/status`, { labels: ['def:twice'], status: 'in_progress' });
    expect(status).toBe(400);
    expect(json.detail).toBe("Error: invalid status 'in_progress'. Expected one of [\"formalized\",\"proved\",\"unformalized\"].");
  });
});

describe('validate and refresh', () => {
  it('renders the validator result with locations and a coverage summary', async () => {
    (fakes.ports.validateBlueprintGraph as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      issues: [
        { code: 'unknown_dependency', file: DOUBLING, line: 4, severity: 'error', message: '\\uses{lem:missing} references an unknown label.' },
        { code: 'issues_truncated', file: ENTRY, line: 1, severity: 'warning', message: '2 additional findings were omitted.' },
      ],
      declarationCount: 6,
      filesChecked: [ENTRY, DOUBLING, SQUARES],
    });
    const { json } = await post(app, `${BP}/blueprint/validate`);
    expect(json).toEqual({
      ok: false,
      summary: 'Checked 6 declarations across 3 TeX files; found 1 errors and 1 warnings.',
      checks: { latex_structure: 'skipped', dependency_graph: 'failed' },
      issues: [
        { code: 'unknown_dependency', file: DOUBLING, line: 4, severity: 'error', message: '\\uses{lem:missing} references an unknown label.', location: `${DOUBLING}:4` },
        { code: 'issues_truncated', file: ENTRY, line: 1, severity: 'warning', message: '2 additional findings were omitted.', location: `${ENTRY}:1` },
      ],
    });
    expect(fakes.ports.validateBlueprintGraph).toHaveBeenCalledWith(tempRoot, ENTRY);
  });

  it('passes a clean blueprint and refuses to validate a missing entrypoint', async () => {
    const clean = await post(app, `${BP}/blueprint/validate`);
    expect(clean.json).toMatchObject({ ok: true, checks: { dependency_graph: 'passed' } });
    const missing: OpenProject = { ...project, blueprintFile: 'blueprint/src/other.tex' };
    fakes.blueprints.openProject.mockReturnValueOnce(missing);
    const { status, json } = await post(app, `${BP}/blueprint/validate`);
    expect(status).toBe(400);
    expect(json.detail).toBe("Error: blueprint source 'blueprint/src/other.tex' does not exist; there is nothing to validate yet.");
  });

  it('refreshes and returns the parsed declarations', async () => {
    const { json } = await post(app, `${BP}/blueprint/refresh`);
    expect(fakes.blueprints.refresh).toHaveBeenCalledTimes(1);
    expect(json.blueprint).toBe('bp');
    expect((json.declarations as unknown[]).length).toBe(6);
    expect((json.declarations as Array<Record<string, unknown>>)[0]).toEqual({ label: 'def:twice', kind: 'definition', title: 'Doubling' });
  });
});

describe('builds', () => {
  it('starts a build through the Lean service and reads diagnostics from the snapshot', async () => {
    const { json } = await post(app, `${BP}/build`, {});
    expect(fakes.lean.startBuild).toHaveBeenCalledWith(project, { reason: 'agent' });
    expect(json).toMatchObject({ status: 'succeeded', message: 'Build complete', target: null, exit_code: null });
    expect(json.errors).toEqual([{ file: 'Sample/Basic.lean', line: 3, column: 1, severity: 'error', message: 'unknown identifier' }]);
    expect(json.warnings).toHaveLength(1);
  });

  it('validates and forwards a module target', async () => {
    fakes.lean.startBuild.mockResolvedValueOnce({ exitCode: 0, diagnostics: [], unscopedErrors: [], message: '', builtModules: ['Sample.Basic'] });
    const { json } = await post(app, `${BP}/build`, { target: 'Sample.Basic' });
    expect(fakes.lean.startBuild).toHaveBeenCalledWith(project, { reason: 'agent', target: 'Sample.Basic' });
    expect(json).toMatchObject({ status: 'succeeded', message: 'Built Sample.Basic', target: 'Sample.Basic', built_modules: ['Sample.Basic'], errors: [] });
    const invalid = await post(app, `${BP}/build`, { target: 'Sample/Basic.lean' });
    expect(invalid.status).toBe(400);
    expect(invalid.json.detail).toBe("Error: invalid module name 'Sample/Basic.lean'. Expected a dotted Lean module identifier (e.g. 'Numina.Blueprints.Froda').");
  });

  it('passes the Lean service errors through', async () => {
    fakes.lean.startBuild.mockRejectedValueOnce(new HttpError(409, 'A project build is in progress. Lean queries resume when it finishes.', 'lean_build_in_progress'));
    const { status, json } = await post(app, `${BP}/build`, {});
    expect(status).toBe(409);
    expect(json.code).toBe('lean_build_in_progress');
  });

  it('reports the build status snapshot and per-file counts', async () => {
    const { json } = await post(app, `${BP}/build/status`);
    expect(json).toEqual({
      status: 'running',
      running: true,
      phase: 'building',
      message: 'Building Lean project...',
      steps: [{ phase: 'building', message: 'Building Lean project...' }],
      persisted: { status: 'done', head: 'abc', toolchain_hash: 't', manifest_hash: 'm', outcome: 'errors' },
      error_count: 2,
      warning_count: 4,
      files_with_errors: [{ file: 'lean/Sample/Basic.lean', errors: 2, warnings: 1 }],
    });
    fakes.lean.buildSnapshot.mockReturnValueOnce(null);
    const idle = await post(app, `${BP}/build/status`);
    expect(idle.json).toMatchObject({ status: 'done', running: false, phase: null });
  });

  it('serves the persisted diagnostics split by severity', async () => {
    const { json } = await post(app, `${BP}/build/errors`);
    expect(json.errors).toEqual([{ file: 'Sample/Basic.lean', line: 3, column: 1, severity: 'error', message: 'unknown identifier' }]);
    expect(json.warnings).toEqual([{ file: 'Sample/Basic.lean', line: 5, column: 1, severity: 'warning', message: 'declaration uses sorry' }]);
  });

  it('reports a stamp-skipped build as failed when the recorded outcome was errors', async () => {
    fakes.lean.startBuild.mockResolvedValueOnce({ status: 'up_to_date', output: null, error: null });
    const { json } = await post(app, `${BP}/build`, {});
    expect(json).toMatchObject({
      status: 'failed',
      message: 'Build up to date: nothing changed since the last build, which finished with 1 error(s)',
      errors: [{ file: 'Sample/Basic.lean', line: 3, column: 1, severity: 'error', message: 'unknown identifier' }],
    });
  });
});

describe('lean helpers', () => {
  it('falls back to the goals query for the term goal and explains an empty expected type', async () => {
    const { status, json } = await post(app, `${BP}/lean/term-goal`, { file_path: 'lean/Sample/Basic.lean', line: 4, column: 13 });
    expect(status).toBe(200);
    expect(fakes.lean.goals).toHaveBeenCalledWith(project, { file_path: 'lean/Sample/Basic.lean', line: 4, column: 13 }, expect.anything());
    expect(json).toEqual({ line_context: '  exact foo _', expected_type: null, note: 'Tactic goals are active at this position; inspect them with lean_goal.' });
  });

  it('prefers a service that implements the plain term goal', async () => {
    const termGoal = vi.fn(async () => ({ line_context: '  exact foo _', expected_type: 'Nat' }));
    const serviced = makeApp(fakes, { blueprints: fakes.blueprints, lean: { ...fakes.lean, termGoal } });
    const { json } = await post(serviced, `${BP}/lean/term-goal`, { file_path: 'lean/Sample/Basic.lean', line: 4 });
    expect(termGoal).toHaveBeenCalledWith(project, { file_path: 'lean/Sample/Basic.lean', line: 4, column: null }, expect.anything());
    expect(fakes.lean.goals).not.toHaveBeenCalled();
    expect(json).toEqual({ line_context: '  exact foo _', expected_type: 'Nat' });
    const invalid = await post(serviced, `${BP}/lean/term-goal`, { file_path: 'lean/Sample/Basic.lean', line: 0 });
    expect(invalid.status).toBe(422);
  });

  it('forwards declaration-scoped diagnostics and applies the web success rule', async () => {
    const { json } = await post(app, `${BP}/lean/diagnostics`, { file_path: 'lean/Sample/Basic.lean', declaration_name: 'twice_eq', start_line: 3, end_line: 6 });
    expect(fakes.lean.diagnostics).toHaveBeenCalledWith(project, { file_path: 'lean/Sample/Basic.lean', start_line: 3, end_line: 6, declaration_name: 'twice_eq' }, expect.anything());
    expect(json).toEqual({
      success: true,
      complete: true,
      items: [{ severity: 'warning', message: 'declaration uses sorry', line: 4, column: 1, end_line: null, end_column: null }],
      failed_dependencies: [],
    });
    fakes.lean.diagnostics.mockResolvedValueOnce({ items: [], complete: true, failed_dependencies: ['Sample/Other.lean'] });
    const broken = await post(app, `${BP}/lean/diagnostics`, { file_path: 'lean/Sample/Basic.lean' });
    expect(fakes.lean.diagnostics.mock.calls[1][1]).toEqual({ file_path: 'lean/Sample/Basic.lean', start_line: null, end_line: null });
    expect(broken.json).toMatchObject({ success: false, failed_dependencies: ['Sample/Other.lean'] });
    fakes.lean.diagnostics.mockResolvedValueOnce({ success: false, items: [], complete: true, failed_dependencies: [] });
    const explicit = await post(app, `${BP}/lean/diagnostics`, { file_path: 'lean/Sample/Basic.lean' });
    expect(explicit.json.success).toBe(false);
    fakes.lean.diagnostics.mockRejectedValueOnce(new HttpError(409, 'Lean is still processing this file. Please retry shortly.', 'lean_query_retry', 2));
    const retry = await post(app, `${BP}/lean/diagnostics`, { file_path: 'lean/Sample/Basic.lean' });
    expect(retry.status).toBe(409);
    expect(retry.json.code).toBe('lean_query_retry');
  });
});

describe('normalizeBuildOutcome', () => {
  it('understands a bare outcome, a BuildOutput, a wrapper and the stamp fallback', () => {
    expect(normalizeBuildOutcome('errors', join(tempRoot, 'lean'))).toMatchObject({ status: 'failed', message: 'Build finished with 1 error(s)' });
    expect(normalizeBuildOutcome({ exitCode: 1, diagnostics: [], unscopedErrors: ['error: manifest out of date'] }, join(tempRoot, 'lean'))).toMatchObject({
      status: 'failed',
      message: 'Build failed: error: manifest out of date',
      exit_code: 1,
    });
    expect(normalizeBuildOutcome({ success: true, output: { exitCode: 0, diagnostics: [{ file: 'A.lean', line: 1, column: 1, severity: 'warning', message: 'w' }] } }, join(tempRoot, 'lean'))).toMatchObject({
      status: 'succeeded',
      warnings: [{ file: 'A.lean', line: 1, column: 1, severity: 'warning', message: 'w' }],
      errors: [],
    });
    expect(normalizeBuildOutcome({ something: 'else' }, join(tempRoot, 'lean')).status).toBe('failed');
    // The Lean service's own BuildOutcome: {status, output: BuildOutput | null, error}.
    // "up to date" repeats the stamped verdict: the fixture's stamp recorded errors.
    expect(normalizeBuildOutcome({ status: 'up_to_date', output: null, error: null }, join(tempRoot, 'lean'))).toMatchObject({
      status: 'failed',
      message: 'Build up to date: nothing changed since the last build, which finished with 1 error(s)',
      errors: [{ file: 'Sample/Basic.lean', line: 3, column: 1, severity: 'error', message: 'unknown identifier' }],
    });
    const clean = mkdtempSync(join(tmpdir(), 'fuse-internal-clean-'));
    try {
      mkdirSync(join(clean, '.lake'), { recursive: true });
      writeFileSync(join(clean, '.lake', '.build-stamp.json'), JSON.stringify({ head: 'abc', outcome: 'ok' }));
      expect(normalizeBuildOutcome({ status: 'up_to_date', output: null, error: null }, clean)).toMatchObject({ status: 'succeeded', message: 'Build up to date', errors: [] });
      writeFileSync(join(clean, '.lake', '.build-stamp.json'), JSON.stringify({ head: 'abc', outcome: 'errors' }));
      expect(normalizeBuildOutcome({ status: 'up_to_date', output: null, error: null }, clean)).toMatchObject({
        status: 'failed',
        message: 'Build up to date: nothing changed since the last build, which failed without positional Lean diagnostics (likely a lakefile, manifest, or toolchain problem)',
      });
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
    expect(normalizeBuildOutcome({ status: 'failed', output: null, error: 'Build timed out after 900s' }, join(tempRoot, 'lean'))).toMatchObject({ status: 'failed', message: 'Build timed out after 900s' });
    expect(
      normalizeBuildOutcome(
        { status: 'errors', output: { exitCode: 1, diagnostics: [{ file: 'A.lean', line: 2, column: 3, severity: 'error', message: 'boom' }], unscopedErrors: [], message: 'Build finished with 1 error(s)', builtModules: ['A'] }, error: null },
        join(tempRoot, 'lean'),
      ),
    ).toMatchObject({ status: 'failed', exit_code: 1, message: 'Build finished with 1 error(s)', errors: [{ file: 'A.lean', line: 2, column: 3, severity: 'error', message: 'boom' }], built_modules: ['A'] });
    expect(normalizeBuildOutcome(undefined, join(tmpdir(), 'no-such-project')).status).toBe('unknown');
  });
});

describe('loogle', () => {
  it('forwards the query and trims the hits', async () => {
    const { json } = await post(app, '/loogle', { query: 'Nat.add_comm', num_results: 1 });
    expect(json).toEqual({ items: [{ name: 'Nat.add_comm', type: 'T', module: 'M' }] });
    const called = (fakes.ports.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(called[0]).toBe('https://loogle.lean-lang.org/json?q=Nat.add_comm');
    expect(called[1].headers['User-Agent']).toBe('fuse-desktop/0.1');
  });

  it('defaults to eight results, requires a query and reports upstream failures', async () => {
    (fakes.ports.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ hits: Array.from({ length: 12 }, (_, i) => ({ name: `n${i}` })) })));
    const many = await post(app, '/loogle', { query: 'x' });
    expect((many.json.items as unknown[]).length).toBe(8);
    const empty = await post(app, '/loogle', { query: '  ' });
    expect(empty.status).toBe(400);
    (fakes.ports.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const failed = await post(app, '/loogle', { query: 'x' });
    expect(failed.status).toBe(502);
    expect(failed.json.detail).toMatch(/upstream service failed/);
  });
});

describe('helpers', () => {
  it('resolves Lean names only when exactly one declaration matches', () => {
    const rows = sampleRows();
    expect(resolveDeclarationByLeanName(rows, 'twice_eq')?.label).toBe('thm:twice-eq');
    expect(resolveDeclarationByLeanName(rows, 'thm:twice_eq')?.label).toBe('thm:twice-eq');
    expect(resolveDeclarationByLeanName(rows, 'Sample.twice_eq')?.label).toBe('thm:twice-eq');
    expect(resolveDeclarationByLeanName([...rows, row({ label: 'dup', leanDeclaration: 'Other.twice_eq' })], 'twice_eq')).toBeNull();
    expect(resolveDeclarationByLeanName(rows, 'nothing')).toBeNull();
  });

  it('validates agent-writable fields', () => {
    expect(validateDeclarationFields({ leanDeclaration: 'x', assessment: null, issues: ['a'], relevantDeclarations: ['Nat.add', { name: 'Nat.mul', source: 'Mathlib' }] })).toBeNull();
    expect(validateDeclarationFields({ kind: 'lemma' })).toMatch(/not settable/);
    expect(validateDeclarationFields({ relevantDeclarations: [{ source: 'x' }] })).toBe("Error: each 'relevantDeclarations' entry needs a non-empty 'name'.");
    expect(validateDeclarationFields({ relevantDeclarations: [{ name: 'n', signature: 3 }] })).toBe("Error: 'relevantDeclarations' entry 'signature' must be a string.");
    expect(validateDeclarationFields('nope')).toBe("Error: 'fields' must be an object mapping field name to value.");
  });
});

describe('loogle via the Lean service', () => {
  it('prefers the registered service and trims its items', async () => {
    const leanWithLoogle = { ...fakes.lean, loogle: vi.fn(async () => ({ items: [{ name: 'a', type: 't', module: 'm' }, { name: 'b', type: 't', module: 'm' }] })) };
    const serviced = makeApp(fakes, { blueprints: fakes.blueprints, lean: leanWithLoogle });
    const { json } = await post(serviced, '/loogle', { query: 'x', num_results: 1 });
    expect(json).toEqual({ items: [{ name: 'a', type: 't', module: 'm' }] });
    expect(leanWithLoogle.loogle).toHaveBeenCalledWith('x', 1);
    expect(fakes.ports.fetch).not.toHaveBeenCalled();
    leanWithLoogle.loogle.mockRejectedValueOnce(new Error('offline'));
    const failed = await post(serviced, '/loogle', { query: 'x' });
    expect(failed.status).toBe(502);
  });
});
