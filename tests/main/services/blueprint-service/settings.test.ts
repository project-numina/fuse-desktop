import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizedPrMode, updateBlueprintSettings } from '@main/services/blueprint-service/settings';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { createProject } from './test-project';

let test: TestContext;

beforeEach(() => {
  test = createTestContext();
});

afterEach(() => test.cleanup());

describe('blueprint settings mutation', () => {
  it('normalizes legacy modes and persists trimmed settings with merged agent options', () => {
    const project = createProject(test);
    expect(normalizedPrMode('legacy' as never)).toBe('off');
    const response = updateBlueprintSettings(test.ctx, project, {
      title: '  Renamed  ',
      orchestrator_child_concurrency: 2,
      agent: { provider: 'codex' },
    });
    expect(response.name).toBe('Renamed');
    expect(response.agent).toMatchObject({ provider: 'codex', codex_sandbox: 'workspace-write' });
    expect(project.blueprint.title).toBe('Renamed');
  });

  it('preserves title and concurrency validation errors', () => {
    const project = createProject(test);
    expect(() => updateBlueprintSettings(test.ctx, project, { title: ' ' })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => updateBlueprintSettings(test.ctx, project, { orchestrator_child_concurrency: 5 })).toThrowError(
      expect.objectContaining({ status: 422, detail: 'Orchestrator concurrency cannot exceed 4.' }),
    );
  });
});
