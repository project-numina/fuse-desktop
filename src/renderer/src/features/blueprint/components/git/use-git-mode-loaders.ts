import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import {
  fetchBlueprintBranchStatus,
  fetchBlueprintCommit,
  fetchBlueprintCommits,
  fetchBlueprintDiff,
  type BlueprintCommit,
  type BlueprintCommitDetail,
  type BlueprintDiffFile,
} from '@/lib/api';
import { firstVisiblePath, reconcileSelectedPath } from './git-mode-derived';

export interface GitRoute {
  owner?: string;
  repo?: string;
  blueprintId?: string;
}

function useRequestLifecycle() {
  const mountedRef = useRef(true);
  const commitDetailRequestId = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      commitDetailRequestId.current += 1;
    };
  }, []);
  return { mountedRef, commitDetailRequestId };
}

function useDiffLoader(
  route: GitRoute,
  mountedRef: MutableRefObject<boolean>,
  setSelectedPath: Dispatch<SetStateAction<string | null>>,
) {
  const [diffFiles, setDiffFiles] = useState<BlueprintDiffFile[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const loadDiff = useCallback(async () => {
    if (!route.owner || !route.repo || !route.blueprintId) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const response = await fetchBlueprintDiff(route.owner, route.repo, route.blueprintId);
      if (!mountedRef.current) return;
      setDiffFiles(response.files);
      setSelectedPath((previous) => reconcileSelectedPath(previous, response.files));
    } catch {
      if (!mountedRef.current) return;
      setDiffError('Could not load pending changes.');
      setDiffFiles([]);
      setSelectedPath(null);
    } finally {
      if (mountedRef.current) setDiffLoading(false);
    }
  }, [route.owner, route.repo, route.blueprintId, mountedRef, setSelectedPath]);
  return { diffFiles, diffLoading, diffError, loadDiff };
}

function useBranchLoader(route: GitRoute, mountedRef: MutableRefObject<boolean>) {
  const [liveBranch, setLiveBranch] = useState<string | null>(null);
  const loadBranchStatus = useCallback(async () => {
    if (!route.owner || !route.repo || !route.blueprintId) return;
    try {
      const response = await fetchBlueprintBranchStatus(route.owner, route.repo, route.blueprintId);
      if (!mountedRef.current) return;
      setLiveBranch(typeof response.branch === 'string' && response.branch ? response.branch : null);
    } catch {
      // Best effort: the blueprint payload or HEAD remains available.
    }
  }, [route.owner, route.repo, route.blueprintId, mountedRef]);
  return { liveBranch, loadBranchStatus };
}

function useCommitListLoader(route: GitRoute, mountedRef: MutableRefObject<boolean>) {
  const [commits, setCommits] = useState<BlueprintCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const loadCommits = useCallback(async () => {
    if (!route.owner || !route.repo || !route.blueprintId) return;
    setCommitsLoading(true);
    setCommitsError(null);
    try {
      const response = await fetchBlueprintCommits(route.owner, route.repo, route.blueprintId);
      if (!mountedRef.current) return;
      setCommits(response.commits);
    } catch {
      if (!mountedRef.current) return;
      setCommitsError('Could not load commit history.');
      setCommits([]);
    } finally {
      if (mountedRef.current) setCommitsLoading(false);
    }
  }, [route.owner, route.repo, route.blueprintId, mountedRef]);
  return { commits, commitsLoading, commitsError, loadCommits };
}

function useCommitDetailState() {
  const [commitDetail, setCommitDetail] = useState<BlueprintCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);
  const [commitDetailError, setCommitDetailError] = useState<string | null>(null);
  const clearCommitDetail = useCallback(() => {
    setCommitDetail(null);
    setCommitDetailError(null);
    setCommitDetailLoading(false);
  }, []);
  return {
    commitDetail,
    setCommitDetail,
    commitDetailLoading,
    setCommitDetailLoading,
    commitDetailError,
    setCommitDetailError,
    clearCommitDetail,
  };
}

function useCommitDetailLoader(
  route: GitRoute,
  mountedRef: MutableRefObject<boolean>,
  requestIdRef: MutableRefObject<number>,
  setSelectedFilePath: Dispatch<SetStateAction<string | null>>,
) {
  const {
    commitDetail,
    setCommitDetail,
    commitDetailLoading,
    setCommitDetailLoading,
    commitDetailError,
    setCommitDetailError,
    clearCommitDetail,
  } = useCommitDetailState();
  const loadCommitDetail = useCallback(async (sha: string): Promise<boolean> => {
    if (!route.owner || !route.repo || !route.blueprintId) return false;
    const requestId = ++requestIdRef.current;
    setCommitDetailLoading(true);
    setCommitDetailError(null);
    try {
      const detail = await fetchBlueprintCommit(route.owner, route.repo, route.blueprintId, sha);
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      setCommitDetail(detail);
      setSelectedFilePath(firstVisiblePath(detail.files));
      return true;
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      setCommitDetailError('Could not load commit detail.');
      setCommitDetail(null);
      setSelectedFilePath(null);
      return true;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setCommitDetailLoading(false);
    }
  }, [
    route.owner, route.repo, route.blueprintId, mountedRef, requestIdRef,
    setCommitDetail, setCommitDetailError, setCommitDetailLoading, setSelectedFilePath,
  ]);
  const cancelCommitDetail = useCallback(() => {
    requestIdRef.current += 1;
    clearCommitDetail();
  }, [clearCommitDetail, requestIdRef]);
  return { commitDetail, commitDetailLoading, commitDetailError, loadCommitDetail, cancelCommitDetail };
}

export function useGitModeLoaders(
  route: GitRoute,
  setSelectedDiffPath: Dispatch<SetStateAction<string | null>>,
  setSelectedCommitFilePath: Dispatch<SetStateAction<string | null>>,
) {
  const { mountedRef, commitDetailRequestId } = useRequestLifecycle();
  const diff = useDiffLoader(route, mountedRef, setSelectedDiffPath);
  const branch = useBranchLoader(route, mountedRef);
  const history = useCommitListLoader(route, mountedRef);
  const detail = useCommitDetailLoader(route, mountedRef, commitDetailRequestId, setSelectedCommitFilePath);
  return { ...diff, ...branch, ...history, ...detail };
}

export type GitModeLoaders = ReturnType<typeof useGitModeLoaders>;
