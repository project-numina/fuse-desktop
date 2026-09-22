/** React adapter for the new-blueprint initialization and submit workflows. */

import { useNavigate } from 'react-router-dom';
import { useNewBlueprintDerivedState } from './filters';
import {
  createSelectionHandlers,
  useNewBlueprintInitialization,
} from './initialization';
import {
  useBranchFormState,
  useCoreFormState,
  useLakefileFormState,
  type BranchFormState,
  type CoreFormState,
  type LakefileFormState,
} from './state';
import { createSubmitHandlers } from './submit';

export interface NewBlueprintFormOptions {
  owner: string;
  repo: string;
  /** Pre-fill the title, e.g. when returning from Lean-project setup. */
  initialTitle?: string;
  /** Pre-select this base branch when it exists. */
  initialBaseBranch?: string;
}

function exposedFormState(
  core: CoreFormState,
  branch: BranchFormState,
  lakefile: LakefileFormState,
  derived: ReturnType<typeof useNewBlueprintDerivedState>,
  selection: ReturnType<typeof createSelectionHandlers>,
  submit: ReturnType<typeof createSubmitHandlers>,
) {
  return {
    blueprintTitle: core.blueprintTitle,
    setBlueprintTitle: core.setBlueprintTitle,
    baseBranch: branch.baseBranch,
    isSubmitting: core.isSubmitting,
    repositoryBranches: branch.repositoryBranches,
    isLoadingBranches: branch.isLoadingBranches,
    branchesLoadFailed: branch.branchesLoadFailed,
    branchSearchQuery: branch.branchSearchQuery,
    setBranchSearchQuery: branch.setBranchSearchQuery,
    errorMessage: core.errorMessage,
    lakefiles: lakefile.lakefiles,
    lakefileSearchQuery: lakefile.lakefileSearchQuery,
    setLakefileSearchQuery: lakefile.setLakefileSearchQuery,
    selectedLakefileDir: lakefile.selectedLakefileDir,
    isLoadingLakefiles: lakefile.isLoadingLakefiles,
    lakefilesLoadFailed: lakefile.lakefilesLoadFailed,
    lakefilesTruncated: lakefile.lakefilesTruncated,
    ...derived,
    ...selection,
    ...submit,
  };
}

export function useNewBlueprintForm(options: NewBlueprintFormOptions) {
  const { owner, repo, initialTitle = '', initialBaseBranch = '' } = options;
  const navigate = useNavigate();
  const coreState = useCoreFormState(initialTitle);
  const branchState = useBranchFormState();
  const lakefileState = useLakefileFormState();
  const derivedState = useNewBlueprintDerivedState(branchState, lakefileState);
  const loadLakefiles = useNewBlueprintInitialization({
    owner, repo, initialBaseBranch, coreState, branchState, lakefileState,
  });
  const selectionHandlers = createSelectionHandlers(
    coreState, branchState, lakefileState, loadLakefiles,
  );
  const submitHandlers = createSubmitHandlers({
    owner, repo, navigate, coreState, branchState, lakefileState,
    noLakefileFound: derivedState.noLakefileFound,
  });
  return exposedFormState(
    coreState,
    branchState,
    lakefileState,
    derivedState,
    selectionHandlers,
    submitHandlers,
  );
}
