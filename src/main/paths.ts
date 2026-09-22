/**
 * Where Fuse Desktop keeps its own state. Everything lives under Electron's
 * userData directory; repositories themselves stay where the user has them.
 *
 *   <userData>/
 *     settings.json              app settings (theme, CLI paths, defaults)
 *     window-state.json
 *     data/
 *       repositories.json        registry of opened folders (RepositoryRow[])
 *       repositories/<id>/
 *         blueprints.json        BlueprintRow[] for that repository
 *         blueprints/<name>/model.json   declaration rows (agent-owned fields)
 *         sources.json           RepositorySourceRow[]
 *         sources/<uuid>/original.<ext> | latex.tex | ocr.tex
 *       conversations/<id>.json  transcript + job metadata
 *       conversations.json       ConversationRow[] index
 */

import { join } from 'node:path';
import { HttpError } from './store/registry';

/**
 * Conversation ids (UUIDs) and blueprint names (slugs) are the only
 * client-supplied strings that become path segments under the data
 * directory. Anything else (`..`, separators, percent-decoded surprises) is
 * rejected here, at the boundary, so a route can never read or delete
 * outside the directory it was meant for.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeSegment(value: string, what: string): string {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new HttpError(404, `${what} not found`, 'http_404');
  }
  return value;
}

export interface AppPaths {
  userData: string;
  dataDir: string;
  repositoriesIndex: string;
  conversationsIndex: string;
  conversationsDir: string;
  repositoryDir(repositoryId: number): string;
  blueprintsIndex(repositoryId: number): string;
  blueprintDir(repositoryId: number, blueprintName: string): string;
  sourcesIndex(repositoryId: number): string;
  sourcesDir(repositoryId: number): string;
  conversationFile(conversationId: string): string;
}

export function appPaths(userData: string): AppPaths {
  const dataDir = join(userData, 'data');
  return {
    userData,
    dataDir,
    repositoriesIndex: join(dataDir, 'repositories.json'),
    conversationsIndex: join(dataDir, 'conversations.json'),
    conversationsDir: join(dataDir, 'conversations'),
    repositoryDir: (id) => join(dataDir, 'repositories', String(id)),
    blueprintsIndex: (id) => join(dataDir, 'repositories', String(id), 'blueprints.json'),
    blueprintDir: (id, name) => join(dataDir, 'repositories', String(id), 'blueprints', assertSafeSegment(name, 'Blueprint')),
    sourcesIndex: (id) => join(dataDir, 'repositories', String(id), 'sources.json'),
    sourcesDir: (id) => join(dataDir, 'repositories', String(id), 'sources'),
    conversationFile: (id) => join(dataDir, 'conversations', `${assertSafeSegment(id, 'Session history')}.json`),
  };
}
