import { useMemo } from 'react';

import {
  type BlueprintCommit,
  type BlueprintCommitDetail,
  type BlueprintCommitDetailFile,
  type BlueprintDiffFile,
} from '@/lib/api';
import {
  buildBody,
  groupCommitsByDay,
  isBotAuthor,
  NUMINA_BOT_AVATAR,
  toCommitView,
} from '@/features/blueprint/lib/commit-history';
import { parseStructuredDiff } from '@/features/blueprint/lib/structured-diff';

interface PathEntry {
  path: string;
}

interface DerivedGitModeArgs {
  blueprintBranch: string | null | undefined;
  liveBranch: string | null;
  diffFiles: BlueprintDiffFile[];
  selectedDiffPath: string | null;
  commits: BlueprintCommit[];
  commitDetail: BlueprintCommitDetail | null;
  selectedCommitFilePath: string | null;
}

export function isMetadataPath(path: string): boolean {
  return path.startsWith('numina/.metadata/')
    || path.startsWith('.metadata/')
    || path.includes('/.metadata/');
}

export function visibleGitFiles<File extends PathEntry>(files: readonly File[]): File[] {
  return files.filter((file) => !isMetadataPath(file.path));
}

export function firstVisiblePath(files: readonly PathEntry[]): string | null {
  return visibleGitFiles(files)[0]?.path ?? null;
}

export function reconcileSelectedPath(previous: string | null, files: readonly PathEntry[]): string | null {
  const visible = visibleGitFiles(files);
  if (previous !== null && visible.some((file) => file.path === previous)) return previous;
  return visible[0]?.path ?? null;
}

function useDiffDerived(diffFiles: BlueprintDiffFile[], selectedDiffPath: string | null) {
  const visibleDiffFiles = useMemo(() => visibleGitFiles(diffFiles), [diffFiles]);
  const selectedDiffFile = useMemo(
    () => visibleDiffFiles.find((file) => file.path === selectedDiffPath) ?? null,
    [selectedDiffPath, visibleDiffFiles],
  );
  const selectedDiffLines = useMemo(
    () => selectedDiffFile?.diff ? parseStructuredDiff(selectedDiffFile.diff) : [],
    [selectedDiffFile],
  );
  return {
    visibleDiffFiles,
    hiddenMetadataDiffCount: diffFiles.length - visibleDiffFiles.length,
    selectedDiffFile,
    selectedDiffLines,
  };
}

function detailHeaderFor(detail: BlueprintCommitDetail | null) {
  if (!detail) return null;
  const subject = (detail.message.split('\n', 1)[0] ?? '').trim();
  const bot = isBotAuthor(detail.author_login, detail.author_name);
  return {
    subject: subject || '(no message)',
    body: buildBody(detail.message),
    actor: bot ? 'Numina Fuse' : detail.author_name || detail.author_login || 'unknown',
    avatarUrl: bot ? NUMINA_BOT_AVATAR : detail.author_avatar_url,
    timestamp: detail.authored_at ? new Date(detail.authored_at) : null,
    shortSha: detail.sha.slice(0, 7),
  };
}

function useHistoryDerived(
  commits: BlueprintCommit[],
  commitDetail: BlueprintCommitDetail | null,
  selectedCommitFilePath: string | null,
) {
  const visibleCommitFiles = useMemo(
    () => visibleGitFiles<BlueprintCommitDetailFile>(commitDetail?.files ?? []),
    [commitDetail],
  );
  const selectedCommitFile = useMemo(
    () => visibleCommitFiles.find((file) => file.path === selectedCommitFilePath) ?? null,
    [selectedCommitFilePath, visibleCommitFiles],
  );
  const selectedCommitFileLines = useMemo(
    () => selectedCommitFile?.patch ? parseStructuredDiff(selectedCommitFile.patch) : [],
    [selectedCommitFile],
  );
  const commitDays = useMemo(() => groupCommitsByDay(commits.map(toCommitView)), [commits]);
  const detailHeader = useMemo(() => detailHeaderFor(commitDetail), [commitDetail]);
  return {
    visibleCommitFiles,
    hiddenMetadataCommitFileCount: (commitDetail?.files.length ?? 0) - visibleCommitFiles.length,
    selectedCommitFile,
    selectedCommitFileLines,
    commitDays,
    detailHeader,
  };
}

export function useGitModeDerived({
  blueprintBranch,
  liveBranch,
  diffFiles,
  selectedDiffPath,
  commits,
  commitDetail,
  selectedCommitFilePath,
}: DerivedGitModeArgs) {
  const branchName = useMemo(() => blueprintBranch || liveBranch || 'HEAD', [blueprintBranch, liveBranch]);
  const diff = useDiffDerived(diffFiles, selectedDiffPath);
  const history = useHistoryDerived(commits, commitDetail, selectedCommitFilePath);
  return { branchName, ...diff, ...history };
}

export type GitModeDerived = ReturnType<typeof useGitModeDerived>;
