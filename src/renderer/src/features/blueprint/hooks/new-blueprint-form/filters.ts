import { useMemo } from 'react';
import {
  filterLakefiles,
} from '@/features/blueprint/lib/blueprint-creation';
import type {
  BranchFormState,
  LakefileFormState,
} from './state';

export function filterBranches(branches: string[], searchQuery: string): string[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return branches;
  return branches.filter((branch) => branch.toLowerCase().includes(query));
}

export function useNewBlueprintDerivedState(
  branchState: BranchFormState,
  lakefileState: LakefileFormState,
) {
  const filteredBranches = useMemo(
    () => filterBranches(branchState.repositoryBranches, branchState.branchSearchQuery),
    [branchState.repositoryBranches, branchState.branchSearchQuery],
  );
  const selectedLakefile = useMemo(
    () => lakefileState.lakefiles.find(
      (entry) => entry.directory === lakefileState.selectedLakefileDir,
    ) || null,
    [lakefileState.lakefiles, lakefileState.selectedLakefileDir],
  );
  const filteredLakefiles = useMemo(
    () => filterLakefiles(lakefileState.lakefiles, lakefileState.lakefileSearchQuery),
    [lakefileState.lakefiles, lakefileState.lakefileSearchQuery],
  );
  const shouldShowLakefileSelector = lakefileState.lakefiles.length > 1;
  const noLakefileFound = !lakefileState.isLoadingLakefiles
    && !lakefileState.lakefilesLoadFailed
    && lakefileState.lakefiles.length === 0;
  return {
    filteredBranches, selectedLakefile, filteredLakefiles,
    shouldShowLakefileSelector, noLakefileFound,
  };
}
