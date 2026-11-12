import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codexGitEnvironment } from '@main/services/sessions/codex-git';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const root = fs.mkdtempSync(join(tmpdir(), 'fuse-codex-git-'));
  dirs.push(root);
  return root;
}

function trustedPaths(env: Record<string, string>): string[] {
  return Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => env[`GIT_CONFIG_VALUE_${i}`]);
}

describe('codexGitEnvironment', () => {
  it('trusts the selected roots and Git dependencies, excluding ordinary package folders', () => {
    const repo = workspace();
    const project = join(repo, 'lean');
    fs.mkdirSync(join(project, '.lake/packages/mathlib/.git'), { recursive: true });
    fs.mkdirSync(join(project, '.lake/packages/lean-pool'), { recursive: true });
    fs.writeFileSync(join(project, '.lake/packages/lean-pool/.git'), 'gitdir: elsewhere');
    fs.mkdirSync(join(project, '.lake/packages/not-a-repo'), { recursive: true });
    const env = codexGitEnvironment(repo, project, {});
    expect(trustedPaths(env)).toEqual([repo, project, join(project, '.lake/packages/lean-pool'), join(project, '.lake/packages/mathlib')].map(p => fs.realpathSync(p).replace(/\\/g, '/')));
    expect(Object.values(env)).not.toContain('*');
    expect(codexGitEnvironment(repo, repo, {}).GIT_CONFIG_COUNT).toBe('1');
  });

  it('preserves inherited command-scope Git options without modifying the base environment', () => {
    const root = workspace();
    const base = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false' };
    const env = codexGitEnvironment(root, root, base);
    expect(env).toMatchObject({ ...base, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'safe.directory' });
    expect(base.GIT_CONFIG_COUNT).toBe('1');
  });

  it('does not trust a dependency resolved outside the selected package tree', () => {
    const root = workspace();
    const dependency = join(root, '.lake/packages/mathlib');
    const outside = workspace();
    fs.mkdirSync(join(outside, '.git'));
    fs.mkdirSync(join(root, '.lake/packages'), { recursive: true });
    fs.symlinkSync(outside, dependency, process.platform === 'win32' ? 'junction' : 'dir');
    expect(trustedPaths(codexGitEnvironment(root, root, {}))).toEqual([root.replace(/\\/g, '/')]);
  });

  it('resolves the ownership error for selected repositories without trusting unrelated repositories', () => {
    const root = workspace();
    const unrelated = workspace();
    for (const directory of [root, unrelated]) {
      const init = spawnSync('git', ['init', directory], { encoding: 'utf8', windowsHide: true });
      expect(init.status, init.stderr).toBe(0);
    }
    const base = { ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '' };
    const git = (directory: string, env: NodeJS.ProcessEnv) => spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { env, encoding: 'utf8', windowsHide: true });
    const before = git(root, base);
    expect(before.status).not.toBe(0);
    expect(before.stderr).toContain('dubious ownership');
    const configBefore = fs.readFileSync(join(root, '.git/config'), 'utf8');
    const fixed = { ...base, ...codexGitEnvironment(root, root, base) };
    const after = git(root, fixed);
    expect(after.status, after.stderr).toBe(0);
    expect(git(unrelated, fixed).stderr).toContain('dubious ownership');
    expect(fs.readFileSync(join(root, '.git/config'), 'utf8')).toBe(configBefore);
  });
});
