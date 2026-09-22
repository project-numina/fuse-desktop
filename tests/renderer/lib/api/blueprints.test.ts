import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  request: vi.fn(),
  fetchApi: vi.fn(),
}));
vi.mock('@/lib/api/core', () => core);

import {
  commitBlueprintChanges,
  createBlueprint,
  createWorkspace,
  DEFAULT_BLUEPRINT_AGENT_CONFIG,
  deleteBlueprint,
  fetchBlueprint,
  fetchBlueprintBranchStatus,
  fetchBlueprintBuildStatus,
  fetchBlueprintChapter,
  fetchBlueprintCommit,
  fetchBlueprintCommits,
  fetchBlueprintDiff,
  fetchBlueprints,
  fetchWorkspaceBlueprintCandidates,
  getPdfInfo,
  setBlueprintLeanProject,
  setBlueprintSourceFile,
  syncBlueprintBranch,
  syncBlueprintFromMain,
  updateBlueprintChapter,
  updateBlueprintContent,
  updateBlueprintSettings,
} from '@/lib/api/blueprints';

const owner = 'owner /?#';
const repo = 'repo /?#';
const name = 'proof /?#';
const basePath = '/repositories/owner%20%2F%3F%23/repo%20%2F%3F%23'
  + '/blueprints/proof%20%2F%3F%23';

describe('blueprint API paths', () => {
  beforeEach(() => {
    core.request.mockReset().mockResolvedValue({});
    core.fetchApi.mockReset().mockResolvedValue({});
  });

  it('defines the complete default desktop agent configuration', () => {
    expect(DEFAULT_BLUEPRINT_AGENT_CONFIG).toEqual({
      provider: 'claude',
      model: '',
      effort: null,
      claude_permission_mode: 'acceptEdits',
      codex_sandbox: 'workspace-write',
    });
  });

  it('encodes repository and blueprint segments for list and detail requests', async () => {
    await fetchBlueprints(owner, repo);
    await fetchBlueprint(owner, repo, name);

    expect(core.request.mock.calls).toEqual([
      [`${basePath.slice(0, basePath.lastIndexOf('/'))}`],
      [basePath, {
        timeoutMs: 20000,
        timeoutMessage: 'Blueprint loading is taking longer than expected. Please try again.',
      }],
    ]);
  });

  it('fetches the branch and build statuses from encoded paths', async () => {
    await fetchBlueprintBranchStatus(owner, repo, name);
    await fetchBlueprintBuildStatus(owner, repo, name);

    expect(core.request.mock.calls.map((call) => call[0])).toEqual([
      `${basePath}/branch-status`,
      `${basePath}/build-status`,
    ]);
  });

  it('serializes chapter paths in both read and update query strings', async () => {
    const chapterPath = 'chapters/Main & More.tex';
    await fetchBlueprintChapter(owner, repo, name, chapterPath);
    await updateBlueprintChapter(owner, repo, name, chapterPath, 'x = 1\n');

    const path = `${basePath}/chapter?path=chapters%2FMain+%26+More.tex`;
    expect(core.request.mock.calls).toEqual([
      [path],
      [path, { method: 'PUT', body: JSON.stringify({ content: 'x = 1\n' }) }],
    ]);
  });

  it('serializes blueprint content without altering LaTeX characters', async () => {
    const latexSource = '\\section{A & B}\n$\\alpha < \\beta$';
    await updateBlueprintContent(owner, repo, name, latexSource);

    expect(core.request).toHaveBeenCalledWith(`${basePath}/content`, {
      method: 'PUT',
      body: JSON.stringify({ latex_source: latexSource }),
    });
  });

  it('distinguishes an omitted commit message from an explicit message', async () => {
    await commitBlueprintChanges(owner, repo, name);
    await commitBlueprintChanges(owner, repo, name, 'Prove “main” / theorem');

    expect(core.request.mock.calls).toEqual([
      [`${basePath}/commit`, { method: 'POST', body: '{}' }],
      [
        `${basePath}/commit`,
        {
          method: 'POST',
          body: JSON.stringify({ message: 'Prove “main” / theorem' }),
        },
      ],
    ]);
  });

  it('posts both branch synchronization operations without a body', async () => {
    await syncBlueprintBranch(owner, repo, name);
    await syncBlueprintFromMain(owner, repo, name);

    expect(core.request.mock.calls).toEqual([
      [`${basePath}/sync`, { method: 'POST' }],
      [`${basePath}/sync-main`, { method: 'POST' }],
    ]);
  });

  it('uses the default and explicit commit limits and encodes commit IDs', async () => {
    await fetchBlueprintCommits(owner, repo, name);
    await fetchBlueprintCommits(owner, repo, name, 0);
    await fetchBlueprintDiff(owner, repo, name);
    await fetchBlueprintCommit(owner, repo, name, 'sha /?#');

    expect(core.request.mock.calls.map((call) => call[0])).toEqual([
      `${basePath}/commits?limit=50`,
      `${basePath}/commits?limit=0`,
      `${basePath}/diff`,
      `${basePath}/commits/sha%20%2F%3F%23`,
    ]);
  });

  it('sets the Lean project with a JSON-encoded lakefile path', async () => {
    await setBlueprintLeanProject(owner, repo, name, 'lean project/lakefile.toml');

    expect(core.request).toHaveBeenCalledWith(`${basePath}/lean-project`, {
      method: 'PUT',
      body: JSON.stringify({ lakefile: 'lean project/lakefile.toml' }),
    });
  });

  it('preserves explicit false, zero, empty, and nested settings values', async () => {
    await updateBlueprintSettings(owner, repo, name, {});
    const settings = {
      title: '',
      description: '',
      pr_mode: 'off' as const,
      auto_commit: false,
      orchestrator_child_concurrency: 0,
      agent: DEFAULT_BLUEPRINT_AGENT_CONFIG,
    };
    await updateBlueprintSettings(owner, repo, name, settings);

    expect(core.request.mock.calls).toEqual([
      [`${basePath}/settings`, { method: 'PATCH', body: '{}' }],
      [
        `${basePath}/settings`,
        { method: 'PATCH', body: JSON.stringify(settings) },
      ],
    ]);
  });

  it('adopts, lists, and creates blueprint source files', async () => {
    await setBlueprintSourceFile(owner, repo, name, 'blueprint/src/content tex.tex');
    await fetchWorkspaceBlueprintCandidates(owner, repo, name);
    await createBlueprint(owner, repo, name);

    expect(core.request.mock.calls).toEqual([
      [
        `${basePath}/source-file`,
        {
          method: 'PUT',
          body: JSON.stringify({ blueprint_file: 'blueprint/src/content tex.tex' }),
        },
      ],
      [`${basePath}/source-candidates`],
      [`${basePath}/create-blueprint`, { method: 'POST' }],
    ]);
  });

  it('deletes the encoded blueprint resource', async () => {
    await deleteBlueprint(owner, repo, name);
    expect(core.request).toHaveBeenCalledWith(basePath, { method: 'DELETE' });
  });

  it('sends workspace creation as the caller-provided multipart form', async () => {
    const formData = new FormData();
    formData.append('title', 'A & B');
    formData.append('latex_content', '\\section{Proof}');

    await createWorkspace(owner, repo, formData);
    expect(core.fetchApi).toHaveBeenCalledWith(
      '/repositories/owner%20%2F%3F%23/repo%20%2F%3F%23/blueprints/create-workspace',
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      },
    );
  });

  it('creates a PDF multipart form containing the exact supplied file', async () => {
    const file = new File(['%PDF-1.7'], 'draft proof.pdf', { type: 'application/pdf' });

    await getPdfInfo(owner, repo, file);
    expect(core.fetchApi).toHaveBeenCalledTimes(1);
    const [path, options] = core.fetchApi.mock.calls[0];
    expect(path).toBe(
      '/repositories/owner%20%2F%3F%23/repo%20%2F%3F%23/blueprints/pdf-info',
    );
    expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('file')).toBe(file);
  });

  it('returns delegated responses and propagates request errors unchanged', async () => {
    const response = { files: [] };
    const pending = Promise.resolve(response);
    core.request.mockReturnValueOnce(pending);
    expect(fetchBlueprintDiff(owner, repo, name)).toBe(pending);
    await expect(pending).resolves.toBe(response);

    const failure = new TypeError('Failed to fetch');
    core.request.mockRejectedValueOnce(failure);
    await expect(fetchBlueprintBuildStatus(owner, repo, name)).rejects.toBe(failure);
  });

  it('returns fetch responses and propagates multipart errors unchanged', async () => {
    const response = { workspace_id: 'workspace-1' };
    core.fetchApi.mockResolvedValueOnce(response);
    await expect(createWorkspace(owner, repo, new FormData())).resolves.toBe(response);

    const failure = new TypeError('Connection closed');
    core.fetchApi.mockRejectedValueOnce(failure);
    const file = new File(['%PDF'], 'broken.pdf', { type: 'application/pdf' });
    await expect(getPdfInfo(owner, repo, file)).rejects.toBe(failure);
  });
});
