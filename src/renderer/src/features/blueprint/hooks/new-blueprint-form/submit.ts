import { createWorkspace } from '@/lib/api';
import {
  createErrorMessage,
  titleToId,
} from '@/features/blueprint/lib/blueprint-creation';
import type {
  BranchFormState,
  CoreFormState,
  LakefileFormState,
} from './state';

interface SubmitOptions {
  owner: string;
  repo: string;
  navigate: (path: string) => void;
  noLakefileFound: boolean;
  coreState: CoreFormState;
  branchState: BranchFormState;
  lakefileState: LakefileFormState;
}

interface ValidationInput {
  title: string;
  isLoadingBranches: boolean;
  branchesLoadFailed: boolean;
  baseBranch: string;
  existingIds: Set<string>;
}

export function creationValidationError(input: ValidationInput): string | null {
  if (!input.title.trim()) return 'Please enter a title';
  if (input.isLoadingBranches) return 'Loading branches, please wait…';
  if (!input.branchesLoadFailed && !input.baseBranch) {
    return 'Please select a base branch';
  }
  if (input.existingIds.has(titleToId(input.title.trim()))) {
    return 'A blueprint with this title already exists';
  }
  return null;
}

export function createWorkspaceFormData(
  title: string,
  baseBranch: string,
  branchesLoadFailed: boolean,
  projectSubdirectory: string,
): FormData {
  const formData = new FormData();
  formData.append('title', title);
  if (!branchesLoadFailed && baseBranch) formData.append('base_branch', baseBranch);
  formData.append('project_subdir', projectSubdirectory);
  return formData;
}

export function scaffoldPath(
  owner: string,
  repo: string,
  title: string,
  baseBranch: string,
): string {
  const params = new URLSearchParams();
  params.set('owner', owner);
  params.set('repo', repo);
  if (baseBranch) params.set('base', baseBranch);
  if (title.trim()) params.set('title', title.trim());
  return `/new?${params.toString()}`;
}

function validate(options: SubmitOptions): boolean {
  const { coreState, branchState } = options;
  coreState.setErrorMessage('');
  const error = creationValidationError({
    title: coreState.blueprintTitle,
    isLoadingBranches: branchState.isLoadingBranches,
    branchesLoadFailed: branchState.branchesLoadFailed,
    baseBranch: branchState.baseBranch,
    existingIds: coreState.existingIdsRef.current,
  });
  if (!error) return true;
  coreState.setErrorMessage(error);
  return false;
}

async function submitWorkspace(options: SubmitOptions): Promise<void> {
  const { owner, repo, navigate, coreState, branchState, lakefileState } = options;
  coreState.setIsSubmitting(true);
  try {
    const formData = createWorkspaceFormData(
      coreState.blueprintTitle,
      branchState.baseBranch,
      branchState.branchesLoadFailed,
      lakefileState.selectedLakefileDir,
    );
    const data = (await createWorkspace(owner, repo, formData)) as { blueprint_id: string };
    navigate(`/repo/${owner}/${repo}/blueprint/${data.blueprint_id}/blueprint`);
  } catch (error) {
    coreState.setErrorMessage(createErrorMessage(error));
  } finally {
    coreState.setIsSubmitting(false);
  }
}

export function createSubmitHandlers(options: SubmitOptions) {
  function goToScaffold(): void {
    options.navigate(scaffoldPath(
      options.owner,
      options.repo,
      options.coreState.blueprintTitle,
      options.branchState.baseBranch,
    ));
  }

  async function handleCreate(): Promise<void> {
    if (!validate(options)) return;
    if (options.noLakefileFound) {
      goToScaffold();
      return;
    }
    await submitWorkspace(options);
  }

  function goBack(): void {
    options.navigate(`/repo/${options.owner}/${options.repo}`);
  }

  return { goToScaffold, handleCreate, goBack };
}
