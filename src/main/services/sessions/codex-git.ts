import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function canonical(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/** Trust the selected workspace and existing Lake checkouts only in this Codex session. */
export function codexGitEnvironment(repoRoot: string, projectRoot: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const repo = canonical(repoRoot);
  const project = canonical(projectRoot);
  const directories = new Set([repo, project]);
  const packages = join(project, '.lake', 'packages');
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const path = join(packages, entry.name);
      if (!existsSync(join(path, '.git'))) continue;
      const actual = canonical(path);
      const within = relative(packages, actual);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) continue;
      directories.add(actual);
    }
  }
  const env: Record<string, string> = {};
  const inheritedCount = Number(base.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(inheritedCount) || inheritedCount < 0) throw new Error('Invalid inherited GIT_CONFIG_COUNT');
  for (let i = 0; i < inheritedCount; i++) {
    for (const prefix of ['GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_']) {
      const key = `${prefix}${i}`;
      if (base[key] === undefined) throw new Error(`Missing inherited ${key}`);
      env[key] = base[key];
    }
  }
  let index = inheritedCount;
  for (const directory of directories) {
    env[`GIT_CONFIG_KEY_${index}`] = 'safe.directory';
    env[`GIT_CONFIG_VALUE_${index++}`] = directory.replace(/\\/g, '/');
  }
  env.GIT_CONFIG_COUNT = String(index);
  return env;
}
