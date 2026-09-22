import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenProject } from '@main/services/types';
import { DEFAULT_AGENT_CONFIG } from '@main/store/rows';
import { Registry } from '@main/store/registry';
import { appPaths } from '@main/paths';
import type { RepositoryRow } from '@main/store/rows';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';
import type { BuildOutcome, LeanService, StartBuildOptions } from '@main/services/lean/service';
import { LeanSetupService, storageAt } from '@main/services/lean/setup';

function projectFor(repository: RepositoryRow, directory = ''): OpenProject {
  const blueprint = {
    id: 'workspace', repository_id: repository.id, title: 'Workspace', description: '', area: '',
    blueprint_file: null, project_subdir: directory, source_type: 'none', source_id: null,
    pr_mode: 'off' as const, auto_commit: false, orchestrator_child_concurrency: 1,
    agent: DEFAULT_AGENT_CONFIG, created_at: '', updated_at: '',
  };
  return { repository, blueprint, clonePath: repository.path, projectRoot: join(repository.path, directory),
    projectSubdir: directory, blueprintFile: null, roomKey: `${repository.owner}/${repository.name}/workspace` };
}

describe('Lean workspace setup', () => {
  let root: string;
  let registry: Registry;
  let repository: RepositoryRow;
  let project: OpenProject;
  let service: LeanSetupService;
  const build = vi.fn();
  const ready = vi.fn();
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fuse-lean-setup-'));
    const path = join(root, 'repo');
    await mkdir(path);
    await writeFile(join(path, 'lakefile.toml'), 'name = "test"');
    registry = new Registry(appPaths(join(root, 'data')));
    repository = registry.addRepository(path);
    build.mockReset().mockResolvedValue({ status: 'ok', error: null, output: null } satisfies BuildOutcome);
    ready.mockReset().mockReturnValue(false);
    project = projectFor(repository);
    service = new LeanSetupService({
      settings: DEFAULT_LEAN_SETTINGS, startBuild: build, lspReady: ready,
    } as unknown as LeanService);
  });
  afterEach(async () => {
    await service.shutdown();
    registry.flushSync();
    await rm(root, { recursive: true, force: true });
  });

  it('checks only the saved project, ignoring unrelated nested lakefiles', async () => {
    await mkdir(join(repository.path, 'nested'));
    await writeFile(join(repository.path, 'nested', 'lakefile.lean'), '-- lake');
    const status = await service.status(project);
    expect(status.projects.map((project) => project.directory)).toEqual(['']);
    expect(status.projects[0].storage?.availableBytes).toBeGreaterThan(0);
    expect(status.projects[0].storage?.totalBytes).toBeGreaterThanOrEqual(status.projects[0].storage!.availableBytes);
    expect(build).not.toHaveBeenCalled();
    expect(registry.listBlueprints(repository.id)).toEqual([]);
  });

  it('recognizes existing setup and persists opt-out across registry reloads', async () => {
    ready.mockReturnValue(true);
    registry.setLeanSetupDismissed(repository.id, true);
    registry.flushSync();
    const reloaded = new Registry(registry.paths).getRepositoryById(repository.id)!;
    expect((await service.status({ ...project, repository: reloaded })).dismissed).toBe(true);
    expect((await service.status({ ...project, repository: reloaded })).projects[0].ready).toBe(true);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects saved paths or symlinks that escape the repository', async () => {
    const external = join(root, 'outside');
    await mkdir(external);
    await writeFile(join(external, 'lakefile.toml'), 'name = "outside"');
    await symlink(external, join(repository.path, 'linked'), 'dir');
    expect((await service.status(project)).projects.map((project) => project.directory)).toEqual(['']);
    await expect(service.start(projectFor(repository, '../outside'))).rejects.toThrow('Lean project must be inside');
    await expect(service.start(projectFor(repository, 'linked'))).rejects.toThrow('Lean project must be inside');
    expect(build).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous requests and forwards progress without creating a workspace', async () => {
    let finish!: (value: BuildOutcome) => void;
    build.mockImplementation((_project: unknown, options: StartBuildOptions) => {
      options.onProgress?.('building', 'Checking modules');
      return new Promise<BuildOutcome>((resolve) => { finish = resolve; });
    });
    await Promise.all([service.start(project), service.start(project)]);
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    expect((await service.status(project)).task).toMatchObject({ status: 'running', steps: ['Checking modules'] });
    expect(registry.listBlueprints(repository.id)).toEqual([]);
    finish({ status: 'ok', output: null, error: null });
    await vi.waitFor(async () => expect((await service.status(project)).task?.status).toBe('ready'));
  });

  it('queues setup pipelines and cancels queued work without building it', async () => {
    const otherPath = join(root, 'other');
    await mkdir(otherPath);
    await writeFile(join(otherPath, 'lakefile.toml'), 'name = "other"');
    const other = registry.addRepository(otherPath);
    let finish!: (value: BuildOutcome) => void;
    build.mockImplementation(() => new Promise<BuildOutcome>((resolve) => { finish = resolve; }));
    await service.start(project);
    await service.start(projectFor(other));
    expect((await service.status(projectFor(other))).task?.status).toBe('queued');
    service.cancel(projectFor(other));
    await vi.waitFor(async () => expect((await service.status(projectFor(other))).task?.status).toBe('cancelled'));
    expect(build).toHaveBeenCalledTimes(1);
    finish({ status: 'ok', error: null, output: null });
  });

  it('cancels running setup and allows a later retry', async () => {
    build.mockImplementationOnce((_project: unknown, options: StartBuildOptions) => new Promise<BuildOutcome>((resolve) => {
      options.signal?.addEventListener('abort', () => resolve({ status: 'failed', output: null, error: 'Build cancelled' }), { once: true });
    }));
    await service.start(project);
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    service.cancel(project);
    await vi.waitFor(async () => expect((await service.status(project)).task?.status).toBe('cancelled'));
    await service.start(project);
    await vi.waitFor(async () => expect((await service.status(project)).task?.status).toBe('ready'));
  });

  it('reports build errors rather than claiming setup succeeded', async () => {
    build.mockResolvedValue({ status: 'errors', output: null, error: null });
    await service.start(project);
    await vi.waitFor(async () => expect((await service.status(project)).task?.status).toBe('failed'));
  });

  it('tolerates unavailable disk information and uses conservative defaults', async () => {
    expect(await storageAt(join(root, 'missing'))).toBeNull();
    expect(DEFAULT_LEAN_SETTINGS.leanNumThreads).toBe(2);
    expect(DEFAULT_LEAN_SETTINGS.maxConcurrentLeanBuilds).toBe(1);
  });
});
