import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { absolutePathIn, blueprintUpdatedAt, openBlueprintProject } from '@main/services/blueprint-service/projects';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { createProject } from './test-project';

let test: TestContext;

beforeEach(() => {
  test = createTestContext();
});

afterEach(() => test.cleanup());

describe('blueprint service projects', () => {
  it('resolves POSIX paths and adopts the conventional entrypoint', () => {
    const project = createProject(test);
    const entrypoint = absolutePathIn(project.clonePath, 'blueprint/src/content.tex');
    mkdirSync(join(entrypoint, '..'), { recursive: true });
    writeFileSync(entrypoint, '\\chapter{Test}\n', 'utf8');
    const reopened = openBlueprintProject(test.ctx, project.repository.owner, project.repository.name, project.blueprint.id);
    expect(reopened.blueprintFile).toBe('blueprint/src/content.tex');
    expect(test.ctx.registry.getBlueprint(project.repository.id, project.blueprint.id)?.blueprint_file).toBe('blueprint/src/content.tex');
  });

  it('uses the latest valid blueprint or conversation timestamp', () => {
    const project = createProject(test);
    expect(
      blueprintUpdatedAt(project.blueprint, [
        { repository_id: project.repository.id, blueprint_id: 'sample', updated_at: '2025-02-01T00:00:00.000Z' } as never,
        { repository_id: project.repository.id, blueprint_id: 'other', updated_at: '2026-01-01T00:00:00.000Z' } as never,
      ]),
    ).toBe('2025-02-01T00:00:00.000Z');
  });
});
