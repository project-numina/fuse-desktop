import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDeclarationRange, findDeclarationSite, scanDeclarations, toRepoRelativeLeanPath } from '@mcp/paths';

const repoPath = resolve(sep === '/' ? '/work/repo' : 'C:\\work\\repo');

describe('toRepoRelativeLeanPath', () => {
  it('maps project-relative and absolute paths to repository-relative posix paths', () => {
    const env = { repoPath, projectRoot: join(repoPath, 'lean') };
    expect(toRepoRelativeLeanPath('Sample/Basic.lean', env)).toBe('lean/Sample/Basic.lean');
    expect(toRepoRelativeLeanPath('./Sample/Basic.lean', env)).toBe('lean/Sample/Basic.lean');
    expect(toRepoRelativeLeanPath(join(repoPath, 'lean', 'Sample', 'Basic.lean'), env)).toBe('lean/Sample/Basic.lean');
  });

  it('works when the project is the repository root', () => {
    const env = { repoPath, projectRoot: repoPath };
    expect(toRepoRelativeLeanPath('Sample.lean', env)).toBe('Sample.lean');
    expect(toRepoRelativeLeanPath(join(repoPath, 'Sample.lean'), env)).toBe('Sample.lean');
  });

  it('refuses paths that escape the project, empty paths and the project root itself', () => {
    const env = { repoPath, projectRoot: join(repoPath, 'lean') };
    expect(() => toRepoRelativeLeanPath('../Other.lean', env)).toThrow("File '../Other.lean' is outside the assigned Lean project.");
    expect(() => toRepoRelativeLeanPath(join(repoPath, 'Other.lean'), env)).toThrow(/outside the assigned Lean project/);
    expect(() => toRepoRelativeLeanPath(resolve(sep === '/' ? '/elsewhere/X.lean' : 'D:\\elsewhere\\X.lean'), env)).toThrow(/outside/);
    expect(() => toRepoRelativeLeanPath('   ', env)).toThrow('file_path must not be empty.');
    expect(() => toRepoRelativeLeanPath('.', { repoPath, projectRoot: repoPath })).toThrow(/outside/);
  });
});

const SOURCE = [
  'import Mathlib',
  '',
  'namespace Foo',
  '',
  '/-- doc -/',
  '@[simp]',
  'theorem bar (n : Nat) : n + 0 = n := by',
  '  simp',
  '',
  'private lemma helper : True := trivial',
  '',
  'def f : Nat → Nat',
  '  | 0 => 0',
  '  | n + 1 => n',
  '',
  'namespace Inner',
  'theorem bar : True := trivial',
  'end Inner',
  '',
  'instance : Inhabited Nat := ⟨0⟩',
  '',
  'noncomputable def g (x : Nat) : Nat :=',
  '  x',
  'termination_by x',
  '',
  'end Foo',
  '',
  'theorem top : True := by',
  '  trivial',
  '',
  '',
].join('\n');

describe('scanDeclarations / findDeclarationSite', () => {
  it('qualifies names with the enclosing namespaces and skips anonymous instances', () => {
    const sites = scanDeclarations(SOURCE);
    expect(sites.map((site) => site.qualified)).toEqual(['Foo.bar', 'Foo.helper', 'Foo.f', 'Foo.Inner.bar', 'Foo.g', 'top']);
  });

  it('prefers an exact qualified match, then a unique suffix, and refuses ambiguity', () => {
    const sites = scanDeclarations(SOURCE);
    expect(findDeclarationSite(sites, 'Foo.bar')?.line).toBe(7);
    expect(findDeclarationSite(sites, 'Inner.bar')?.line).toBe(17);
    expect(findDeclarationSite(sites, 'helper')?.line).toBe(10);
    expect(findDeclarationSite(sites, 'bar')).toBeNull();
    expect(findDeclarationSite(sites, 'missing')).toBeNull();
    expect(findDeclarationSite(sites, '')).toBeNull();
  });
});

describe('findDeclarationRange', () => {
  it('spans from the attribute line to the last body line before the next command', () => {
    expect(findDeclarationRange(SOURCE, 'Foo.bar')).toEqual({ startLine: 6, endLine: 8 });
  });

  it('keeps column-0 match arms and termination_by inside the declaration', () => {
    expect(findDeclarationRange(SOURCE, 'Foo.f')).toEqual({ startLine: 12, endLine: 14 });
    expect(findDeclarationRange(SOURCE, 'Foo.g')).toEqual({ startLine: 22, endLine: 24 });
  });

  it('trims trailing blank lines at end of file and reports misses as null', () => {
    expect(findDeclarationRange(SOURCE, 'top')).toEqual({ startLine: 28, endLine: 29 });
    expect(findDeclarationRange(SOURCE, 'nope')).toBeNull();
  });

  it('handles CRLF sources', () => {
    const crlf = 'theorem a : True := by\r\n  trivial\r\n\r\ntheorem b : True := trivial\r\n';
    expect(findDeclarationRange(crlf, 'a')).toEqual({ startLine: 1, endLine: 2 });
    expect(findDeclarationRange(crlf, 'b')).toEqual({ startLine: 4, endLine: 4 });
  });

  it('does not end a declaration at a column-0 comment inside its proof', () => {
    const source = [
      'theorem a : True ∧ True := by',
      '  constructor',
      '-- the second component',
      '  · trivial',
      '/- a block comment',
      '   at column 0 -/',
      '  · trivial',
      '-- trailing remark',
      '',
      '/-- Docstring of b. -/',
      'theorem b : True := trivial',
      '',
    ].join('\n');
    expect(findDeclarationRange(source, 'a')).toEqual({ startLine: 1, endLine: 7 });
    expect(findDeclarationRange(source, 'b')).toEqual({ startLine: 11, endLine: 11 });
  });
});

describe('scanDeclarations with sections', () => {
  it('lets `end <name>` close a section without popping the enclosing namespace', () => {
    const source = ['namespace Foo', 'section Foo', 'variable (n : Nat)', 'theorem inner : True := trivial', 'end Foo', 'theorem outer : True := trivial', 'end Foo', 'section', 'theorem anon : True := trivial', 'end', 'theorem top : True := trivial', ''].join('\n');
    expect(scanDeclarations(source).map((site) => site.qualified)).toEqual(['Foo.inner', 'Foo.outer', 'anon', 'top']);
  });

  it('ignores declaration-like text inside block comments', () => {
    const source = ['/- theorem ghost : True := trivial', '-/', 'theorem real : True := trivial', ''].join('\n');
    expect(scanDeclarations(source).map((site) => site.qualified)).toEqual(['real']);
  });
});
