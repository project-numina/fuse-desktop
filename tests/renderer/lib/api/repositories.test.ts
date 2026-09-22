import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  request: vi.fn(),
  fetchApi: vi.fn(),
  repoPath: (owner: string, repo: string) =>
    `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
}));
vi.mock('@/lib/api/core', () => core);

import {
  discoverLakefiles,
  deleteRepositorySource,
  fetchPullRequests,
  fetchRepositories,
  fetchRepository,
  fetchRepositoryActivity,
  fetchRepositoryBackgroundSessions,
  fetchRepositoryBranches,
  fetchRepositoryDirectory,
  fetchRepositoryFiles,
  fetchRepositorySources,
  importRepositorySource,
  registerRepository,
  setupRepository,
  unregisterRepository,
  uploadRepositorySource,
} from '@/lib/api/repositories';

const encodedOwner = 'owner /?#';
const encodedRepo = 'repo /?#';
const encodedRepoPath = '/repositories/owner%20%2F%3F%23/repo%20%2F%3F%23';

describe('repository API paths', () => {
  beforeEach(() => {
    core.request.mockReset().mockResolvedValue({});
    core.fetchApi.mockReset().mockResolvedValue({});
  });

  it('registers a local folder with a JSON body', async () => {
    core.request.mockResolvedValue({ id: 1, owner: 'home', name: 'proj', visibility: 'private' });
    const row = await registerRepository('C:\\Users\\ada\\proj');
    expect(core.request).toHaveBeenCalledWith('/repositories', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\Users\\ada\\proj' }),
    });
    expect(row.owner).toBe('home');
  });

  it('keeps the listing, activity, and detail routes', async () => {
    await fetchRepositories();
    await fetchRepositoryActivity();
    await fetchRepositoryBackgroundSessions();
    await fetchRepository('own er', 'repo');
    await fetchPullRequests('own er', 'repo');
    await fetchRepositoryBranches('own er', 'repo');
    expect(core.request.mock.calls.map((call) => call[0])).toEqual([
      '/repositories',
      '/repositories/activity',
      '/repositories/background-sessions',
      '/repositories/own%20er/repo',
      '/repositories/own%20er/repo/pull-requests',
      '/repositories/own%20er/repo/branches',
    ]);
  });

  it('forgets a folder with DELETE on the repository path', async () => {
    core.request.mockResolvedValue(null);
    await expect(unregisterRepository('own er', 'repo')).resolves.toBeUndefined();
    expect(core.request).toHaveBeenCalledWith('/repositories/own%20er/repo', { method: 'DELETE' });
  });

  // A workspace runs in the folder on its checked-out branch, so the picker
  // must list the working tree even when the form hands over a branch name.
  it('always discovers lakefiles from the working tree, never another ref', async () => {
    await discoverLakefiles('o', 'r');
    await discoverLakefiles('o', 'r', 'feature/x');
    expect(core.request.mock.calls.map((call) => call[0])).toEqual([
      '/repositories/o/r/lakefiles',
      '/repositories/o/r/lakefiles',
    ]);
  });

  it('only sends the optional setup fields that are set', async () => {
    await setupRepository('o', 'r', 'Proj');
    await setupRepository('o', 'r', 'Proj', 'v4.13.0', 'lean', 'main');
    expect(core.request.mock.calls).toEqual([
      ['/repositories/o/r/setup', { method: 'POST', body: JSON.stringify({ module_name: 'Proj' }) }],
      [
        '/repositories/o/r/setup',
        {
          method: 'POST',
          body: JSON.stringify({
            module_name: 'Proj',
            lean_version: 'v4.13.0',
            target_subdir: 'lean',
            base_branch: 'main',
          }),
        },
      ],
    ]);
  });

  it('scopes source listings only when a blueprint is supplied', async () => {
    await fetchRepositorySources(encodedOwner, encodedRepo);
    await fetchRepositorySources(encodedOwner, encodedRepo, 'blueprint /?#');

    expect(core.request.mock.calls.map((call) => call[0])).toEqual([
      `${encodedRepoPath}/sources`,
      `${encodedRepoPath}/sources?blueprint_id=blueprint%20%2F%3F%23`,
    ]);
  });

  it('encodes workspace file and directory queries and forwards the abort signal', async () => {
    const controller = new AbortController();
    await fetchRepositoryFiles(encodedOwner, encodedRepo, 'blueprint /?#');
    await fetchRepositoryDirectory(
      encodedOwner,
      encodedRepo,
      'blueprint /?#',
      'src /?#',
      controller.signal,
    );

    expect(core.request.mock.calls).toEqual([
      [`${encodedRepoPath}/repo-files?blueprint_name=blueprint%20%2F%3F%23`],
      [
        `${encodedRepoPath}/blueprints/blueprint%20%2F%3F%23/directory`
        + '?path=src%20%2F%3F%23',
        { signal: controller.signal },
      ],
    ]);
  });

  it('deletes global and blueprint-scoped sources from encoded paths', async () => {
    await deleteRepositorySource(encodedOwner, encodedRepo, 'source /?#');
    await deleteRepositorySource(
      encodedOwner,
      encodedRepo,
      'source /?#',
      'blueprint /?#',
    );

    expect(core.request.mock.calls).toEqual([
      [`${encodedRepoPath}/sources/source%20%2F%3F%23`, { method: 'DELETE' }],
      [
        `${encodedRepoPath}/sources/source%20%2F%3F%23`
        + '?blueprint_id=blueprint%20%2F%3F%23',
        { method: 'DELETE' },
      ],
    ]);
  });

  it('serializes every source-upload option branch into multipart fields', async () => {
    const file = new File(['paper'], 'paper.pdf', { type: 'application/pdf' });
    await uploadRepositorySource(encodedOwner, encodedRepo, file);
    await uploadRepositorySource(encodedOwner, encodedRepo, file, { displayName: '   ' });
    await uploadRepositorySource(encodedOwner, encodedRepo, file, {
      displayName: '  Main paper  ',
    });
    await uploadRepositorySource(encodedOwner, encodedRepo, file, {
      projectScoped: true,
    });
    await uploadRepositorySource(encodedOwner, encodedRepo, file, {
      projectScoped: true,
      blueprintId: 'blueprint /?#',
    });

    expect(core.fetchApi.mock.calls.map(([path, options]) => ({
      path,
      method: options.method,
      credentials: options.credentials,
      fields: Object.fromEntries((options.body as FormData).entries()),
    }))).toEqual([
      {
        path: `${encodedRepoPath}/sources`,
        method: 'POST',
        credentials: 'include',
        fields: { file },
      },
      {
        path: `${encodedRepoPath}/sources`,
        method: 'POST',
        credentials: 'include',
        fields: { file },
      },
      {
        path: `${encodedRepoPath}/sources`,
        method: 'POST',
        credentials: 'include',
        fields: { file, display_name: 'Main paper' },
      },
      {
        path: `${encodedRepoPath}/sources`,
        method: 'POST',
        credentials: 'include',
        fields: { file, project_scoped: 'true' },
      },
      {
        path: `${encodedRepoPath}/sources`,
        method: 'POST',
        credentials: 'include',
        fields: {
          file,
          project_scoped: 'true',
          blueprint_id: 'blueprint /?#',
        },
      },
    ]);
  });

  it('imports a repository file with JSON and workspace routing metadata', async () => {
    const response = {
      id: 'source-1',
      display_name: 'Main.lean',
      source_type: 'lean',
      artifacts: [],
    };
    core.fetchApi.mockResolvedValueOnce(response);

    await expect(importRepositorySource(
      encodedOwner,
      encodedRepo,
      'blueprint /?#',
      'Mathlib/Main file.lean',
    )).resolves.toBe(response);
    expect(core.fetchApi).toHaveBeenCalledWith(`${encodedRepoPath}/sources/import`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blueprint_id: 'blueprint /?#',
        repo_path: 'Mathlib/Main file.lean',
      }),
      workspaceRuntimeIdentity: {
        owner: encodedOwner,
        repository: encodedRepo,
        blueprint: 'blueprint /?#',
      },
    });
  });

  it('returns delegated promises and propagates request failures unchanged', async () => {
    const response = { repositories: [] };
    const pending = Promise.resolve(response);
    core.request.mockReturnValueOnce(pending);
    expect(fetchRepositories()).toBe(pending);
    await expect(pending).resolves.toBe(response);

    const failure = new TypeError('Failed to fetch');
    core.request.mockRejectedValueOnce(failure);
    await expect(fetchRepository(encodedOwner, encodedRepo)).rejects.toBe(failure);

    core.request.mockRejectedValueOnce(failure);
    await expect(unregisterRepository(encodedOwner, encodedRepo)).rejects.toBe(failure);
  });

  it('returns fetch promises and propagates upload failures unchanged', async () => {
    const response = {
      id: 'source-1',
      display_name: 'Main.lean',
      source_type: 'lean',
      artifacts: [],
    };
    const pending = Promise.resolve(response);
    core.fetchApi.mockReturnValueOnce(pending);
    expect(importRepositorySource(encodedOwner, encodedRepo, 'blueprint', 'Main.lean'))
      .toBe(pending);
    await expect(pending).resolves.toBe(response);

    const failure = new TypeError('Connection closed');
    core.fetchApi.mockRejectedValueOnce(failure);
    const file = new File(['paper'], 'paper.pdf', { type: 'application/pdf' });
    await expect(uploadRepositorySource(encodedOwner, encodedRepo, file)).rejects.toBe(failure);
  });
});
