import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeBuildOutcome, readBuildSnapshot } from '@main/server/routes/internal/build';

describe('internal build helpers', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function projectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'internal-build-'));
    dirs.push(root);
    mkdirSync(join(root, '.lake'));
    return root;
  }

  it('flattens persisted per-file diagnostics', () => {
    const root = projectRoot();
    writeFileSync(join(root, '.lake', '.build-errors.json'), JSON.stringify({
      version: 2,
      updated_at: '2026-01-01T00:00:00.000Z',
      content_hashes: { 'A.lean': 'abc' },
      files: { 'A.lean': [{ file: 'A.lean', line: 4, column: 2, severity: 'error', message: 'bad' }] },
    }));
    expect(readBuildSnapshot(root)).toEqual([{ file: 'A.lean', line: 4, column: 2, severity: 'error', message: 'bad' }]);
  });

  it('normalizes explicit build output without consulting external services', () => {
    const result = normalizeBuildOutcome({
      output: {
        exitCode: 1,
        diagnostics: [{ file: 'A.lean', line: 2, severity: 'warning', message: 'sorry' }],
        unscopedErrors: ['lake failed'],
        builtModules: ['A'],
      },
    }, projectRoot());
    expect(result).toEqual({
      status: 'failed',
      message: 'Build failed: lake failed',
      exit_code: 1,
      errors: [],
      warnings: [{ file: 'A.lean', line: 2, column: 0, severity: 'warning', message: 'sorry' }],
      unscoped_errors: ['lake failed'],
      built_modules: ['A'],
    });
  });
});
