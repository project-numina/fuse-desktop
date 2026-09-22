import { describe, expect, it } from 'vitest';
import type { OpenProject } from '@main/services/types';
import {
  normalizeSourceFilter,
  optionalInt,
  readJsonBody,
  requireInt,
  resolveDeclarationByLeanName,
  stringList,
  validateDeclarationFields,
  validateLabel,
} from '@main/server/routes/internal/helpers';

describe('internal route helpers', () => {
  it('parses empty and object bodies while rejecting other JSON shapes', async () => {
    const context = (text: string) => ({ req: { text: async () => text } });
    await expect(readJsonBody(context(''))).resolves.toEqual({});
    await expect(readJsonBody(context('{"ok":true}'))).resolves.toEqual({ ok: true });
    await expect(readJsonBody(context('[]'))).rejects.toMatchObject({ status: 400, code: 'blueprint_tool_error' });
    await expect(readJsonBody(context('{'))).rejects.toMatchObject({ status: 400, code: 'blueprint_tool_error' });
  });

  it('validates integer inputs and optional values', () => {
    expect(requireInt({ line: 2 }, 'line', 1)).toBe(2);
    expect(optionalInt({}, 'column', 1)).toBeNull();
    expect(() => requireInt({ line: 0 }, 'line', 1)).toThrow('line must be an integer >= 1.');
  });

  it('normalizes repository and project-relative source filters', () => {
    const project = { clonePath: '/repo', projectSubdir: 'lean' } as OpenProject;
    expect([...normalizeSourceFilter(project, './Sample.lean')]).toEqual(['Sample.lean', 'lean/Sample.lean']);
    expect([...normalizeSourceFilter(project, '/repo/lean/Sample.lean')]).toEqual(['lean/Sample.lean']);
    expect([...normalizeSourceFilter(project, '/outside/Sample.lean')]).toEqual([]);
  });

  it('keeps string lists, resolves unique Lean names, and validates agent fields', () => {
    expect(stringList(['a', 1, 'b'])).toEqual(['a', 'b']);
    const rows = [{ label: 'a', leanDeclaration: 'A.foo' }, { label: 'b', leanDeclaration: 'B.bar' }];
    expect(resolveDeclarationByLeanName(rows, 'foo')).toBe(rows[0]);
    expect(validateLabel('lem:safe-name')).toBeNull();
    expect(validateLabel('../unsafe')).toContain('invalid declaration label');
    expect(validateDeclarationFields({ notes: 'ok', relevantDeclarations: [{ name: 'Nat.add_comm', source: 'mathlib' }] })).toBeNull();
    expect(validateDeclarationFields({ status: 'proved' })).toContain('not settable');
  });
});
