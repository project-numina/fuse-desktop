import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NewProjectForm from '@/pages/new-project/NewProjectForm';
import type { NewProjectWorkflow } from '@/pages/new-project/use-new-project-workflow';
import type { Repository } from '@/state/dashboard';

function workflow(
  overrides: Partial<NewProjectWorkflow> = {},
): NewProjectWorkflow {
  const repository: Repository = {
    id: 1,
    owner: 'home',
    name: 'alpha',
    description: null,
    updated_at: null,
    visibility: 'private',
    weekly_commits: [],
    background_sessions: [],
  };
  return {
    availableRepos: [repository],
    canSubmit: true,
    chooseFolder: vi.fn(async () => {}),
    directMode: false,
    errorMessage: '',
    filteredRepos: [repository],
    goBack: vi.fn(),
    handleCreate: vi.fn(async () => {}),
    isDesktopAvailable: true,
    isLoadingLeanVersions: false,
    isLoadingRepositories: false,
    isOpeningFolder: false,
    isSubmitting: false,
    moduleName: 'Alpha',
    nextStep: vi.fn(),
    onModuleNameInput: vi.fn(),
    previousStep: vi.fn(),
    repoSearchQuery: '',
    selectedLeanVersionId: '__mathlib_default__',
    selectedRepoId: 1,
    setRepoSearchQuery: vi.fn(),
    setSelectedLeanVersionId: vi.fn(),
    setSelectedRepoId: vi.fn(),
    setTargetSubdir: vi.fn(),
    stableLeanVersionTags: [{ name: 'v4.25.0' }],
    step: 1,
    targetSubdir: '',
    ...overrides,
  };
}

describe('NewProjectForm', () => {
  it('renders repository selection and delegates step navigation', () => {
    const values = workflow();
    render(<NewProjectForm workflow={values} />);

    expect(screen.getByRole('option', { name: /home\/alpha/ }))
      .toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(values.nextStep).toHaveBeenCalledOnce();
  });

  it('renders settings errors and direct-mode cancellation', () => {
    const values = workflow({
      directMode: true,
      errorMessage: 'Setup failed.',
      step: 2,
    });
    render(<NewProjectForm workflow={values} />);

    expect(screen.getByLabelText('Module name')).toHaveValue('Alpha');
    expect(screen.getByText('Setup failed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(values.previousStep).toHaveBeenCalledOnce();
  });
});
