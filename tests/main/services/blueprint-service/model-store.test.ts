import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlueprintModelStore } from '@main/services/blueprint-service/model-store';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { createProject } from './test-project';

let test: TestContext;

beforeEach(() => {
  test = createTestContext();
});

afterEach(() => test.cleanup());

describe('BlueprintModelStore', () => {
  it('persists parser refreshes and builds a safe, unique watch set', () => {
    const project = createProject(test, 'docs/main.tex');
    const store = new BlueprintModelStore(test.ctx.paths);
    const { model, changed } = store.refresh(project);
    expect(changed).toBe(true);
    expect(model.declarations.size).toBe(1);
    expect(store.declarationCount(project.repository.id, project.blueprint.id)).toBe(1);
    expect(store.watchFiles(project, ['docs/main.tex', '../escape.tex'], ['docs/missing.tex', 'docs/main.tex'])).toEqual([
      'docs/main.tex',
      'docs/missing.tex',
    ]);
  });
});
