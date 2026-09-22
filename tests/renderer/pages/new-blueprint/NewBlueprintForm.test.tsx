import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewBlueprintForm, {
  type NewBlueprintFormState,
} from '@/pages/new-blueprint/NewBlueprintForm';

const lakefile = {
  directory: 'Math',
  lakefile: 'lakefile.toml' as const,
  path: 'Math/lakefile.toml',
};

function createForm(
  overrides: Partial<NewBlueprintFormState> = {},
): NewBlueprintFormState {
  return {
    blueprintTitle: 'Initial title',
    setBlueprintTitle: vi.fn(),
    baseBranch: 'main',
    isSubmitting: false,
    repositoryBranches: ['main'],
    isLoadingBranches: false,
    branchesLoadFailed: false,
    branchSearchQuery: '',
    setBranchSearchQuery: vi.fn(),
    errorMessage: '',
    lakefiles: [lakefile],
    lakefileSearchQuery: '',
    setLakefileSearchQuery: vi.fn(),
    selectedLakefileDir: 'Math',
    isLoadingLakefiles: false,
    lakefilesLoadFailed: false,
    lakefilesTruncated: false,
    filteredBranches: ['main'],
    filteredLakefiles: [lakefile],
    selectedLakefile: lakefile,
    shouldShowLakefileSelector: false,
    noLakefileFound: false,
    selectBaseBranch: vi.fn(),
    selectLakefile: vi.fn(),
    handleCreate: vi.fn(),
    goToScaffold: vi.fn(),
    goBack: vi.fn(),
    ...overrides,
  };
}

describe('NewBlueprintForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wires title, project, submit, and cancel interactions', () => {
    const form = createForm();
    render(<NewBlueprintForm form={form} />);

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'New proof' },
    });
    fireEvent.keyDown(screen.getByLabelText(/Title/), { key: 'Enter' });
    fireEvent.change(screen.getByRole('searchbox', { name: /Lean project/ }), {
      target: { value: 'math' },
    });
    fireEvent.click(screen.getByRole('option', { name: lakefile.path }));
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(form.setBlueprintTitle).toHaveBeenCalledWith('New proof');
    expect(form.setLakefileSearchQuery).toHaveBeenCalledWith('math');
    expect(form.selectLakefile).toHaveBeenCalledWith(lakefile);
    expect(form.handleCreate).toHaveBeenCalledTimes(2);
    expect(form.goBack).toHaveBeenCalledOnce();
  });

  it.each([
    [{ isLoadingLakefiles: true }, 'Finding Lean projects…'],
    [
      { lakefilesLoadFailed: true },
      'Could not detect Lean projects in this folder.',
    ],
    [
      { lakefiles: [], filteredLakefiles: [], selectedLakefile: null },
      'No Lean project found in this folder.',
    ],
    [
      {
        lakefiles: [],
        filteredLakefiles: [],
        selectedLakefile: null,
        lakefilesTruncated: true,
      },
      'This folder is too large to scan fully',
    ],
    [
      { filteredLakefiles: [], lakefileSearchQuery: 'docs' },
      'No Lean projects match "docs".',
    ],
  ])('renders the project-list state %#', (overrides, message) => {
    render(<NewBlueprintForm form={createForm(overrides)} />);
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
  });

  it('shows errors and truncated scan status without a branch picker', () => {
    render(
      <NewBlueprintForm
        form={createForm({
          errorMessage: 'Title is required.',
          lakefilesTruncated: true,
        })}
      />,
    );

    expect(screen.getByText('Title is required.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Some Lean projects may be missing');
    expect(screen.getByText(/branch that is checked out/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Base branch' })).not.toBeInTheDocument();
  });

  it('uses setup and submitting labels with the original precedence', () => {
    const { rerender } = render(
      <NewBlueprintForm
        form={createForm({ noLakefileFound: true, isSubmitting: true })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Set up Lean project' })).toBeDisabled();

    rerender(
      <NewBlueprintForm
        form={createForm({ noLakefileFound: false, isSubmitting: true })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
  });
});
