import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow } from '@main/store/rows';
import { openBlueprintProject } from '@main/services/blueprint-service/projects';
import type { TestContext } from '@test/main/services/workspace/test-context';

export function createProject(test: TestContext, blueprintFile: string | null = null) {
  const repositoryPath = join(test.root, 'repository');
  mkdirSync(repositoryPath, { recursive: true });
  if (blueprintFile) {
    const absolute = join(repositoryPath, ...blueprintFile.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, '\\begin{lemma}\n\\label{lem:test}\nTest.\n\\end{lemma}\n', 'utf8');
  }
  const repository = test.ctx.registry.addRepository(repositoryPath);
  const now = '2025-01-01T00:00:00.000Z';
  const row: BlueprintRow = {
    id: 'sample',
    repository_id: repository.id,
    title: 'Sample',
    description: '',
    area: '',
    blueprint_file: blueprintFile,
    project_subdir: '',
    source_type: 'none',
    source_id: null,
    pr_mode: 'off',
    auto_commit: false,
    orchestrator_child_concurrency: 1,
    agent: { ...DEFAULT_AGENT_CONFIG },
    created_at: now,
    updated_at: now,
  };
  test.ctx.registry.insertBlueprint(row);
  return openBlueprintProject(test.ctx, repository.owner, repository.name, row.id);
}
