import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlueprintEntry } from '@shared/api-types';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type RepositoryRow } from '@main/store/rows';
import type { OpenProject } from '@main/services/types';
import * as leanLocations from '@main/services/blueprint/lean-locations';
import { applyParserRefresh, createEmptyModel, getDeclaration, listDeclarations, loadModel, saveModel, updateDeclarationFields, type BlueprintModel, type ParsedDeclaration } from '@main/services/blueprint/model';
import {
  apiSourceType,
  deriveOcrPhase,
  getBlueprintFromClone,
  mergeCloneLeanFiles,
  resolveEntryLeanFiles,
  resolveIncludedFilesFromClone,
  resolveSourcePaths,
} from '@main/services/blueprint/read';

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../fixtures/sample-blueprint');

let tmp: string;

function write(root: string, relative: string, content: string): void {
  const target = join(root, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function initRepo(cwd: string): void {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'initial');
}

function entry(label: string, leanName = '', leanFile = ''): BlueprintEntry {
  return { label, kind: 'lemma', title: '', statement: '', lean_name: leanName, lean_file: leanFile, lean_line: 0, uses: [], proof: null, issues: [], status: '', source_file: '' };
}

function project(clonePath: string, name: string, overrides: Partial<BlueprintRow> = {}): OpenProject {
  const repository: RepositoryRow = { id: 1, owner: 'owner', name: 'repo', path: clonePath, description: null, created_at: 't', last_activity_at: null };
  const blueprint: BlueprintRow = {
    id: name,
    repository_id: 1,
    title: name.charAt(0).toUpperCase() + name.slice(1),
    description: '',
    area: '',
    blueprint_file: null,
    project_subdir: '',
    source_type: 'none',
    source_id: null,
    pr_mode: 'off',
    auto_commit: true,
    orchestrator_child_concurrency: 1,
    agent: DEFAULT_AGENT_CONFIG,
    created_at: 't',
    updated_at: 'u',
    ...overrides,
  };
  const projectSubdir = blueprint.project_subdir;
  return {
    repository,
    blueprint,
    clonePath,
    projectSubdir,
    projectRoot: projectSubdir ? join(clonePath, ...projectSubdir.split('/')) : clonePath,
    blueprintFile: blueprint.blueprint_file,
    roomKey: `owner/repo/${name}`,
  };
}

function parsed(label: string, overrides: Partial<ParsedDeclaration> = {}): ParsedDeclaration {
  return { label, kind: 'theorem', title: label, statement: 'S', proof: null, uses: [], sourceFile: '', proofSourceFile: '', leanDeclaration: '', leanFile: '', status: 'not_started', ...overrides };
}

/** Seed rows directly (the web tests insert BlueprintDeclaration rows). */
function seed(model: BlueprintModel, declarations: Array<{ label: string; kind?: string; title?: string; leanDeclaration?: string; leanFile?: string; status?: string; assessment?: string }>): void {
  applyParserRefresh(model, {
    declarations: declarations.map((data) => parsed(data.label, { kind: data.kind ?? '', title: data.title ?? '', leanDeclaration: data.leanDeclaration ?? '', leanFile: data.leanFile ?? '', status: data.status ?? '' })),
    includedFiles: [],
    labelsInSource: new Set(declarations.map((data) => data.label)),
  });
  for (const data of declarations) if (data.assessment) updateDeclarationFields(model, data.label, { assessment: data.assessment });
}

function kakeyaProject(root: string): string {
  const projectDir = join(root, 'lean', 'kakeya');
  write(projectDir, 'lakefile.toml', '');
  write(projectDir, 'Kakeya/Density.lean', 'namespace Kakeya\n\ndef densityIn : Nat := 0\n\nend Kakeya\n');
  return projectDir;
}

function cacheDensityLocation(projectDir: string): void {
  write(projectDir, '.lake/fuse-declaration-locations.json', JSON.stringify({ version: 1, locations: { 'Kakeya.densityIn': { file: 'Kakeya/Density.lean', start_line: 3 } } }));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-read-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('small helpers', () => {
  it('derives the OCR phase', () => {
    expect(deriveOcrPhase('pdf', 'text', 'scanning')).toBe('scanning');
    expect(deriveOcrPhase('latex', 'text', null)).toBe('');
    expect(deriveOcrPhase('pdf', '', null)).toBe('');
    expect(deriveOcrPhase('pdf', '% OCR pending\n', null)).toBe('');
    expect(deriveOcrPhase('pdf', 'done', null)).toBe('complete');
  });

  it('resolves legacy source paths and API source types', () => {
    expect(resolveSourcePaths('demo', 'pdf')).toEqual(['numina/blueprints/demo/source/demo-source-ocr.tex', 'numina/blueprints/demo/source/demo-source.pdf']);
    expect(resolveSourcePaths('demo', 'latex')).toEqual(['numina/blueprints/demo/source/demo-source.tex', '']);
    expect(apiSourceType('none')).toBe('');
    expect(apiSourceType('tex')).toBe('latex');
    expect(apiSourceType('pdf')).toBe('pdf');
    expect(apiSourceType(undefined)).toBe('');
  });

  it('merges clone lean files with the module fallback', () => {
    expect(mergeCloneLeanFiles([entry('a', '', 'Demo/A.lean'), entry('b', '', 'Gone.lean')], ['Demo/B.lean'], ['Demo/A.lean', 'Demo/B.lean', 'Demo/C.lean'], null, '')).toEqual([
      ['Demo/A.lean', 'Demo/B.lean'],
      ['Demo/A.lean', 'Demo/B.lean', 'Demo/C.lean'],
    ]);
    expect(mergeCloneLeanFiles([], [], ['Numina/Blueprints/Froda.lean', 'Other.lean'], 'Numina.Blueprints.Froda', '')).toEqual([
      ['Numina/Blueprints/Froda.lean'],
      ['Numina/Blueprints/Froda.lean', 'Other.lean'],
    ]);
  });

  it('normalizes cached included files with the entrypoint first', () => {
    const clone = join(tmp, 'clone');
    write(clone, 'blueprint/src/content.tex', '\\input{a}\n');
    write(clone, 'blueprint/src/a.tex', '');
    expect(resolveIncludedFilesFromClone(clone, 'x', { includedFiles: ['blueprint/src/a.tex', '../bad.tex', 'blueprint/src/a.tex'], blueprintFile: null }, 'blueprint/src/content.tex')).toEqual([
      'blueprint/src/content.tex',
      'blueprint/src/a.tex',
    ]);
    expect(resolveIncludedFilesFromClone(clone, 'x', { includedFiles: [], blueprintFile: null }, 'blueprint/src/content.tex')).toEqual(['blueprint/src/content.tex', 'blueprint/src/a.tex']);
  });
});

describe('resolveEntryLeanFiles', () => {
  const BLUEPRINT = 'lean/kakeya/blueprint/src/content.tex';

  it('fills repo-relative file and line from the LSP cache', async () => {
    cacheDensityLocation(kakeyaProject(tmp));
    const resolved = await resolveEntryLeanFiles([entry('d', 'Kakeya.densityIn')], tmp, BLUEPRINT);
    expect(resolved[0].lean_file).toBe('lean/kakeya/Kakeya/Density.lean');
    expect(resolved[0].lean_line).toBe(3);
  });

  it('reads the cache once for all entries', async () => {
    cacheDensityLocation(kakeyaProject(tmp));
    const spy = vi.spyOn(leanLocations, 'readCachedLeanLocations');
    await resolveEntryLeanFiles([entry('first', 'Kakeya.densityIn'), entry('second', 'Kakeya.densityIn')], tmp, BLUEPRINT);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lets the cache override a project-relative leanfile', async () => {
    cacheDensityLocation(kakeyaProject(tmp));
    const resolved = await resolveEntryLeanFiles([entry('d', 'Kakeya.densityIn', 'Kakeya/Density.lean')], tmp, BLUEPRINT);
    expect(resolved[0].lean_file).toBe('lean/kakeya/Kakeya/Density.lean');
    expect(resolved[0].lean_line).toBe(3);
  });

  it('normalizes an unresolved leanfile that exists', async () => {
    const projectDir = kakeyaProject(tmp);
    write(projectDir, 'Kakeya/Other.lean', 'theorem t := 1\n');
    const resolved = await resolveEntryLeanFiles([entry('d', 'Not.Indexed', 'Kakeya/Other.lean')], tmp, BLUEPRINT);
    expect(resolved[0].lean_file).toBe('lean/kakeya/Kakeya/Other.lean');
    expect(resolved[0].lean_line).toBe(0);
  });

  it('drops an unresolved leanfile to a missing file', async () => {
    kakeyaProject(tmp);
    const resolved = await resolveEntryLeanFiles([entry('d', 'Not.Indexed', 'Kakeya/Missing.lean')], tmp, BLUEPRINT);
    expect(resolved[0].lean_file).toBe('');
  });

  it('leaves an already repo-relative leanfile alone', async () => {
    const projectDir = kakeyaProject(tmp);
    write(projectDir, 'Kakeya/Other.lean', 'theorem t := 1\n');
    const resolved = await resolveEntryLeanFiles([entry('d', '', 'lean/kakeya/Kakeya/Other.lean')], tmp, BLUEPRINT);
    expect(resolved[0].lean_file).toBe('lean/kakeya/Kakeya/Other.lean');
  });

  it('returns the same entries when none carry Lean data', async () => {
    const entries = [entry('a')];
    expect(await resolveEntryLeanFiles(entries, tmp, null)).toBe(entries);
  });
});

describe('getBlueprintFromClone', () => {
  it('excludes declaration paths outside the repo tree', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'numina/blueprints/scheme/scheme.tex', '');
    write(clone, 'FLT/Scheme/Basic.lean', '-- repo content\n');
    write(clone, '.lake/packages/mathlib/Mathlib/AlgebraicGeometry/StructureSheaf.lean', '-- mathlib content\n');
    const model = createEmptyModel();
    seed(model, [
      { kind: 'definition', label: 'def:scheme', title: 'Scheme', leanFile: 'FLT/Scheme/Basic.lean' },
      { kind: 'definition', label: 'def:structure-sheaf', title: 'Structure Sheaf', leanFile: 'Mathlib/AlgebraicGeometry/StructureSheaf.lean', assessment: 'ALREADY_IN_MATHLIB' },
    ]);
    const response = await getBlueprintFromClone(project(clone, 'scheme'), model, { refresh: false });
    expect(response.lean_files).toContain('FLT/Scheme/Basic.lean');
    const mathlibPath = 'Mathlib/AlgebraicGeometry/StructureSheaf.lean';
    expect(response.lean_files).not.toContain(mathlibPath);
    expect(response.all_lean_files).not.toContain(mathlibPath);
    expect(response.all_lean_files.every((path) => !path.startsWith('.lake/'))).toBe(true);
  });

  it('scopes the file tree to the selected project', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'numina/blueprints/kakeya/kakeya.tex', '');
    for (const relative of ['lean/kakeya/Kakeya.lean', 'lean/kakeya/Kakeya/Basic.lean', 'lean/conjectures/Conjectures.lean', 'apps/example/Example.lean']) {
      write(clone, relative, '-- source\n');
    }
    initRepo(clone);
    // Edits on the branch: one inside the project, one outside.
    write(clone, 'lean/kakeya/Kakeya.lean', '-- source\n-- more\n');
    write(clone, 'apps/example/Example.lean', '-- changed\n');
    const model = createEmptyModel();
    seed(model, [{ kind: 'theorem', label: 'thm:kakeya', title: 'Kakeya', leanFile: 'lean/kakeya/Kakeya/Basic.lean' }]);
    const response = await getBlueprintFromClone(project(clone, 'kakeya', { project_subdir: 'lean/kakeya' }), model, { refresh: false });
    expect(response.project_subdir).toBe('lean/kakeya');
    expect(response.all_lean_files).toEqual(['lean/kakeya/Kakeya/Basic.lean', 'lean/kakeya/Kakeya.lean']);
    expect(response.lean_files).toEqual(['lean/kakeya/Kakeya/Basic.lean', 'lean/kakeya/Kakeya.lean']);
    expect(response.lean_files).not.toContain('apps/example/Example.lean');
    expect(Object.keys(response.file_diff_stats)).toEqual(['lean/kakeya/Kakeya.lean']);
    expect(response.file_diff_stats['lean/kakeya/Kakeya.lean']).toEqual({ added: 1, deleted: 0 });
  });

  it('adopts the selected project entrypoint', async () => {
    const clone = join(tmp, 'clone');
    const candidate = 'lean/kakeya/blueprint/src/content.tex';
    write(clone, candidate, '\\begin{theorem}[Kakeya]\n\\label{thm:kakeya}\nStatement.\n\\end{theorem}\n');
    const model = createEmptyModel();
    const response = await getBlueprintFromClone(project(clone, 'kakeya', { project_subdir: 'lean/kakeya' }), model);
    expect(response.blueprint_file).toBe(candidate);
    expect(response.entries.map((e) => e.label)).toEqual(['thm:kakeya']);
    expect(response.included_files).toEqual([candidate]);
  });

  it('exposes the declaration status as stored', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'numina/blueprints/demo/demo.tex', '');
    const model = createEmptyModel();
    seed(model, [
      { kind: 'theorem', label: 'thm:proved', title: 'Proved', leanDeclaration: 'Demo.proved', leanFile: 'Demo/Proved.lean', status: 'proved' },
      { kind: 'lemma', label: 'lem:in-progress', title: 'In progress', leanDeclaration: 'Demo.helper', leanFile: 'Demo/Proved.lean', status: 'in_progress' },
      { kind: 'lemma', label: 'lem:no-status', title: 'No status', leanDeclaration: 'Demo.other', leanFile: 'Demo/Proved.lean' },
    ]);
    const response = await getBlueprintFromClone(project(clone, 'demo'), model, { refresh: false });
    const byLabel = Object.fromEntries(response.entries.map((e) => [e.label, e]));
    expect(byLabel['thm:proved'].status).toBe('proved');
    expect(byLabel['lem:in-progress'].status).toBe('in_progress');
    expect(byLabel['lem:no-status'].status).toBe('');
    // Declaration lean files that do not exist in the tree are not linked.
    expect(byLabel['thm:proved'].lean_file).toBe('');
  });

  it('uses the stored blueprint file for the content', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'blueprint/src/content.tex', 'Imported content');
    const model = createEmptyModel();
    seed(model, [{ kind: 'theorem', label: 'thm:i', title: 'I' }]);
    const response = await getBlueprintFromClone(project(clone, 'imported', { blueprint_file: 'blueprint/src/content.tex' }), model, { refresh: false });
    expect(response.blueprint_file).toBe('blueprint/src/content.tex');
    expect(response.blueprint_content).toBe('Imported content');
    expect(response.source_content).toBe('');
    expect(response.name).toBe('Imported');
    expect(response.entries.map((e) => e.label)).toEqual(['thm:i']);
  });

  it('parses on read and groups by chapter', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'blueprint/src/content.tex', '\\input{chapter/intro}\n\\input{chapter/main}\n');
    write(clone, 'blueprint/src/chapter/intro.tex', '\\chapter{Intro}\n\\label{chap:intro}\n\\begin{definition}[Function]\n\\label{def:function}\nA function.\n\\end{definition}\n');
    write(clone, 'blueprint/src/chapter/main.tex', '\\begin{theorem}[Main]\n\\label{thm:main}\nMain result.\n\\end{theorem}\n');
    const model = createEmptyModel();
    const response = await getBlueprintFromClone(project(clone, 'imported', { blueprint_file: 'blueprint/src/content.tex' }), model);
    expect(Object.fromEntries(response.entries.map((e) => [e.label, e.source_file]))).toEqual({
      'def:function': 'blueprint/src/chapter/intro.tex',
      'thm:main': 'blueprint/src/chapter/main.tex',
    });
    expect(response.included_files).toEqual(['blueprint/src/content.tex', 'blueprint/src/chapter/intro.tex', 'blueprint/src/chapter/main.tex']);
    expect(response.chapter_titles).toEqual({ 'blueprint/src/chapter/intro.tex': 'Intro' });
    expect(response.chapter_references).toEqual({ 'chap:intro': '1' });
    expect(Object.keys(response.chapter_contents).sort()).toEqual(['blueprint/src/chapter/intro.tex', 'blueprint/src/chapter/main.tex']);
    expect(response.chapter_contents['blueprint/src/chapter/main.tex']).toContain('Main result.');
    expect(model.parserRevision).toBe(1);
    expect(model.includedFiles).toEqual(response.included_files);
  });

  it('parses on read with duplicate labels', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'blueprint/src/content.tex', '\\input{web}\n\\input{print}\n');
    write(clone, 'blueprint/src/web.tex', '\\begin{definition}[Dimensions]\n\\label{def:dimensions}\nWeb copy.\n\\end{definition}\n');
    write(clone, 'blueprint/src/print.tex', '\\begin{definition}[Dimensions]\n\\label{def:dimensions}\nPrint copy.\n\\end{definition}\n');
    const response = await getBlueprintFromClone(project(clone, 'duplicated', { blueprint_file: 'blueprint/src/content.tex' }), model(), {});
    expect(response.entries.map((e) => e.label)).toEqual(['def:dimensions']);
    expect(response.entries[0].statement).toContain('Web copy.');
  });

  it('loads, refreshes and persists the model itself when called with the project only', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'blueprint/src/content.tex', '\\begin{theorem}[T]\n\\label{thm:t}\n\\lean{Demo.t}\nS.\n\\end{theorem}\n');
    const openProject = project(clone, 'solo', { blueprint_file: 'blueprint/src/content.tex' });
    const response = await getBlueprintFromClone(openProject);
    expect(response.entries.map((e) => e.label)).toEqual(['thm:t']);
    const persisted = loadModel(openProject.projectRoot);
    expect(persisted.parserRevision).toBe(1);
    expect(getDeclaration(persisted, 'thm:t')?.leanDeclaration).toBe('Demo.t');
    // Agent-written fields saved by the service survive the next read.
    updateDeclarationFields(persisted, 'thm:t', { notes: 'kept' });
    saveModel(openProject.projectRoot, persisted);
    await getBlueprintFromClone(openProject);
    expect(getDeclaration(loadModel(openProject.projectRoot), 'thm:t')?.notes).toBe('kept');
  });

  it('serves an empty payload for a workspace without a blueprint', async () => {
    const clone = join(tmp, 'clone');
    mkdirSync(clone);
    const response = await getBlueprintFromClone(project(clone, 'empty'), createEmptyModel());
    expect(response.blueprint_file).toBe('');
    expect(response.blueprint_content).toBe('');
    expect(response.included_files).toEqual([]);
    expect(response.entries).toEqual([]);
    expect(response.chapter_contents).toEqual({});
    expect(response.latex_macros).toEqual({});
  });

  it('reads the legacy on-disk source and honours a supplied source view', async () => {
    const clone = join(tmp, 'clone');
    write(clone, 'numina/blueprints/demo/demo.tex', '');
    write(clone, 'numina/blueprints/demo/source/demo-source-ocr.tex', 'OCR text');
    write(clone, 'numina/blueprints/demo/source/demo-source.pdf', '%PDF');
    const legacy = await getBlueprintFromClone(project(clone, 'demo', { source_type: 'pdf' }), createEmptyModel());
    expect(legacy.source_type).toBe('pdf');
    expect(legacy.source_content).toBe('OCR text');
    expect(legacy.source_pdf_url).toBe('/api/repositories/owner/repo/files-raw/numina/blueprints/demo/source/demo-source.pdf');
    expect(legacy.ocr_phase).toBe('complete');
    const stored = await getBlueprintFromClone(project(clone, 'demo', { source_type: 'pdf' }), createEmptyModel(), {
      source: { source_content: 'stored', source_type: 'latex', source_file_url: '/api/x', source_pdf_url: '' },
      livePhase: 'scanning',
    });
    expect(stored.source_content).toBe('stored');
    expect(stored.source_type).toBe('latex');
    expect(stored.source_file_url).toBe('/api/x');
    expect(stored.ocr_phase).toBe('scanning');
  });

  it('assembles the full payload for the fixture project', async () => {
    const clone = join(tmp, 'sample');
    cpSync(FIXTURE, clone, { recursive: true });
    initRepo(clone);
    write(clone, 'Sample/Squares.lean', 'import Sample.Basic\n\ndef square (n : Nat) : Nat := n * n\n');
    const model = createEmptyModel();
    updateDeclarationFields(model, 'nope', {});
    const openProject = project(clone, 'sample', { title: 'Sample Blueprint', description: 'Notes', area: 'Numbers', pr_mode: 'draft', auto_commit: false, orchestrator_child_concurrency: 2 });
    const response = await getBlueprintFromClone(openProject, model, { branchStatus: { branch: 'main', is_dirty: true, commits_ahead: 0, commits_behind: 0, is_diverged: false, needs_reconcile: false } });

    expect(response.id).toBe('sample');
    expect(response.name).toBe('Sample Blueprint');
    expect(response.description).toBe('Notes');
    expect(response.area).toBe('Numbers');
    expect(response.can_edit).toBe(true);
    expect(response.is_merged).toBe(false);
    expect(response.runtime_route_tag).toBeNull();
    expect(response.open_pr_number).toBeNull();
    expect(response.branch_freshness).toBeNull();
    expect(response.branch_status?.is_dirty).toBe(true);
    expect(response.pr_mode).toBe('draft');
    expect(response.auto_commit).toBe(false);
    expect(response.orchestrator_child_concurrency).toBe(2);
    expect(response.project_subdir).toBe('');
    expect(response.blueprint_file).toBe('blueprint/src/content.tex');
    expect(response.blueprint_content).toContain('\\chapter{Introduction}');
    expect(response.included_files).toEqual(['blueprint/src/content.tex', 'blueprint/src/chapters/doubling.tex', 'blueprint/src/chapters/squares.tex']);
    expect(response.chapter_titles).toEqual({ 'blueprint/src/chapters/doubling.tex': 'Doubling', 'blueprint/src/chapters/squares.tex': 'Squares' });
    expect(response.chapter_references).toEqual({ 'chap:doubling': '1', 'chap:squares': '2' });
    expect(response.entries.map((e) => e.label)).toEqual(['def:twice', 'lem:twice-zero', 'thm:twice-eq', 'def:square', 'thm:twice-le-square', 'conj:cube']);
    const byLabel = Object.fromEntries(response.entries.map((e) => [e.label, e]));
    expect(byLabel['def:twice'].status).toBe('proved');
    expect(byLabel['lem:twice-zero'].status).toBe('proved');
    expect(byLabel['thm:twice-eq'].lean_name).toBe('twice_eq');
    expect(byLabel['thm:twice-eq'].uses).toEqual(['def:twice']);
    expect(byLabel['thm:twice-le-square'].uses).toEqual(['def:twice', 'def:square']);
    expect(byLabel['thm:twice-le-square'].status).toBe('in_progress');
    expect(byLabel['thm:twice-le-square'].source_file).toBe('blueprint/src/chapters/squares.tex');
    expect(byLabel['conj:cube'].status).toBe('not_started');
    expect(byLabel['conj:cube'].proof).toBeNull();
    expect(response.entry_count).toBe(6);
    // Associated files lead, then the rest of the tree in sorted order.
    expect(response.all_lean_files).toEqual(['Sample/Squares.lean', 'Sample.lean', 'Sample/Basic.lean']);
    expect(response.lean_files).toEqual(['Sample/Squares.lean']);
    expect(response.file_diff_stats).toEqual({ 'Sample/Squares.lean': { added: 0, deleted: 8 } });
    expect(response.source_type).toBe('');
    expect(response.ocr_phase).toBe('');
    expect(listDeclarations(model)).toHaveLength(6);
    expect(getDeclaration(model, 'def:twice')?.leanDeclaration).toBe('twice');
  });

  function model(): BlueprintModel {
    return createEmptyModel();
  }
});
