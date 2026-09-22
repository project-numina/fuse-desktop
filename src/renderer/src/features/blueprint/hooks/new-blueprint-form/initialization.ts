import { useCallback, useEffect, useRef } from 'react';
import {
  discoverLakefiles,
  fetchBlueprints,
  fetchRepositoryBranches,
  type LakefileEntry,
} from '@/lib/api';
import {
  defaultLakefile,
  sortLakefilesByDepth,
} from '@/features/blueprint/lib/blueprint-creation';
import type {
  BranchFormState,
  CoreFormState,
  LakefileFormState,
} from './state';

interface InitializationOptions {
  owner: string;
  repo: string;
  initialBaseBranch: string;
  coreState: CoreFormState;
  branchState: BranchFormState;
  lakefileState: LakefileFormState;
}

interface LakefileLoadContext {
  owner: string;
  repo: string;
  branchForRequest: () => string | undefined;
  lakefileState: LakefileFormState;
}

function loadKey(branch: string | undefined): string {
  return branch || '__default__';
}

export function resolveRepositoryBranches(
  branches: unknown[],
  defaultBranch: string,
): string[] {
  const valid = branches.filter(
    (branch): branch is string => typeof branch === 'string' && Boolean(branch.trim()),
  );
  const unique = Array.from(new Set(valid));
  if (unique.length > 0) return unique;
  return defaultBranch ? [defaultBranch] : [];
}

function nextLakefileDirectory(
  entries: LakefileEntry[],
  selectedDirectory: string,
): string {
  const selectionExists = entries.some((entry) => entry.directory === selectedDirectory);
  if (selectedDirectory && selectionExists) return selectedDirectory;
  return defaultLakefile(entries)?.directory || '';
}

function beginLakefileLoad(key: string, state: LakefileFormState): void {
  state.setIsLoadingLakefiles(true);
  state.loadingForRef.current = key;
  state.setLakefilesLoadFailed(false);
  state.loadedForRef.current = null;
  state.setLakefilesTruncated(false);
  state.setLakefiles([]);
}

function applyLakefileResponse(
  response: Awaited<ReturnType<typeof discoverLakefiles>>,
  key: string,
  state: LakefileFormState,
): void {
  const sorted = sortLakefilesByDepth(response.lakefiles);
  state.setLakefiles(sorted);
  state.setLakefilesTruncated(response.truncated);
  state.loadedForRef.current = key;
  state.setSelectedLakefileDir(nextLakefileDirectory(
    sorted,
    state.selectedLakefileDirRef.current,
  ));
}

/** Only the request whose branch key is still current may publish results. */
async function discoverForBranch(
  context: LakefileLoadContext,
  branch: string | undefined,
  key: string,
): Promise<void> {
  const { owner, repo, branchForRequest, lakefileState } = context;
  try {
    const response = await discoverLakefiles(owner, repo, branch);
    if (loadKey(branchForRequest()) !== key) return;
    applyLakefileResponse(response, key, lakefileState);
  } catch {
    if (loadKey(branchForRequest()) !== key) return;
    lakefileState.setLakefilesLoadFailed(true);
    lakefileState.setSelectedLakefileDir('');
  } finally {
    if (lakefileState.loadingForRef.current === key) {
      lakefileState.loadingForRef.current = null;
      lakefileState.setIsLoadingLakefiles(false);
    }
  }
}

function useLakefileLoader(options: InitializationOptions): () => Promise<void> {
  const { owner, repo, branchState, lakefileState } = options;
  const branchForRequest = useCallback(() => (
    !branchState.branchesLoadFailedRef.current && branchState.baseBranchRef.current
      ? branchState.baseBranchRef.current
      : undefined
  ), [branchState.baseBranchRef, branchState.branchesLoadFailedRef]);
  return useCallback(async () => {
    const branch = branchForRequest();
    const key = loadKey(branch);
    if (
      lakefileState.loadedForRef.current === key
      || lakefileState.loadingForRef.current === key
    ) return;
    beginLakefileLoad(key, lakefileState);
    await discoverForBranch({ owner, repo, branchForRequest, lakefileState }, branch, key);
  }, [owner, repo, branchForRequest, lakefileState]);
}

async function initializeExistingIds(options: InitializationOptions): Promise<void> {
  try {
    const blueprints = (await fetchBlueprints(options.owner, options.repo)) as { id: string }[];
    options.coreState.existingIdsRef.current = new Set(
      blueprints.map((blueprint) => blueprint.id),
    );
  } catch {
    // Non-critical: the backend still rejects duplicate ids.
  }
}

async function initializeBranches(options: InitializationOptions): Promise<void> {
  const { owner, repo, initialBaseBranch, branchState } = options;
  try {
    const response = await fetchRepositoryBranches(owner, repo);
    const branches = resolveRepositoryBranches(response.branches, response.default_branch);
    branchState.setRepositoryBranches(branches);
    branchState.setBaseBranch(
      initialBaseBranch && branches.includes(initialBaseBranch)
        ? initialBaseBranch
        : response.default_branch || branches[0] || '',
    );
  } catch {
    branchState.setBranchesLoadFailed(true);
    branchState.setRepositoryBranches([]);
    branchState.setBaseBranch('');
  } finally {
    branchState.setIsLoadingBranches(false);
  }
}

async function bootstrap(
  options: InitializationOptions,
  loadLakefiles: () => Promise<void>,
): Promise<void> {
  await initializeExistingIds(options);
  await initializeBranches(options);
  void loadLakefiles();
}

export function useNewBlueprintInitialization(
  options: InitializationOptions,
): () => Promise<void> {
  const loadLakefiles = useLakefileLoader(options);
  // React StrictMode replays effects; one bootstrap per mounted hook keeps
  // branch and lakefile requests from racing their own duplicate.
  const didBootstrapRef = useRef(false);
  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    void bootstrap(options, loadLakefiles);
    // Initialization intentionally runs once; current values live in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return loadLakefiles;
}

export function createSelectionHandlers(
  coreState: CoreFormState,
  branchState: BranchFormState,
  lakefileState: LakefileFormState,
  loadLakefiles: () => Promise<void>,
) {
  function selectBaseBranch(branch: string): void {
    branchState.setBaseBranch(branch);
    lakefileState.setLakefileSearchQuery('');
    lakefileState.setSelectedLakefileDir('');
    lakefileState.loadedForRef.current = null;
    void loadLakefiles();
  }

  function selectLakefile(entry: LakefileEntry): void {
    coreState.setErrorMessage('');
    lakefileState.setSelectedLakefileDir(entry.directory);
  }

  return { selectBaseBranch, selectLakefile };
}
