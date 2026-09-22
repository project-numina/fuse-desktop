/**
 * Resolve an agent-reported path to one of the repository-relative files the
 * current workspace can display.
 *
 * Tool calls usually report an absolute clone path, while the Lean viewer is
 * keyed by repository-relative paths. Prefer the longest suffix match so a
 * nested path wins over a same-named root file. Do not fall back to a unique
 * basename: common Lean filenames from dependencies can otherwise link to an
 * unrelated workspace file.
 */
export const EMPTY_FILE_PATHS: readonly string[] = [];

const availableFilePathIndexes = new WeakMap<
  readonly string[],
  ReadonlyMap<string, string>
>();

export function resolveAvailableFilePath(
  reportedPath: string,
  availablePaths: readonly string[],
): string | null {
  const normalizedReportedPath = normalizePath(reportedPath);
  if (!normalizedReportedPath) return null;

  const pathIndex = availableFilePathIndex(availablePaths);
  const reportedSegments = normalizedReportedPath.split('/');
  // Removing one leading segment at a time visits possible suffixes from
  // longest to shortest. Lookup cost depends on path depth, not workspace size.
  for (let index = 0; index < reportedSegments.length; index += 1) {
    const match = pathIndex.get(reportedSegments.slice(index).join('/'));
    if (match) return match;
  }
  return null;
}

function availableFilePathIndex(
  availablePaths: readonly string[],
): ReadonlyMap<string, string> {
  const cached = availableFilePathIndexes.get(availablePaths);
  if (cached) return cached;

  const index = new Map<string, string>();
  for (const path of availablePaths) {
    const normalized = normalizePath(path);
    if (normalized) index.set(normalized, path);
  }
  availableFilePathIndexes.set(availablePaths, index);
  return index;
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}
