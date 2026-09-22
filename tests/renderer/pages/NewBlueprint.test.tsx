import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const form = vi.hoisted(() => ({ blueprintTitle: 'Initial title', setBlueprintTitle: vi.fn(), baseBranch: 'main', isSubmitting: false, repositoryBranches: ['main', 'feature'], isLoadingBranches: false, branchesLoadFailed: false, branchSearchQuery: '', setBranchSearchQuery: vi.fn(), errorMessage: '', lakefiles: [{ directory: 'Math', lakefile: 'lakefile.toml', path: 'Math/lakefile.toml' }], lakefileSearchQuery: '', setLakefileSearchQuery: vi.fn(), selectedLakefileDir: 'Math', isLoadingLakefiles: false, lakefilesLoadFailed: false, lakefilesTruncated: false, filteredBranches: ['main', 'feature'], filteredLakefiles: [{ directory: 'Math', lakefile: 'lakefile.toml', path: 'Math/lakefile.toml' }], selectedLakefile: { directory: 'Math', lakefile: 'lakefile.toml', path: 'Math/lakefile.toml' }, noLakefileFound: false, selectBaseBranch: vi.fn(), selectLakefile: vi.fn(), handleCreate: vi.fn(), goBack: vi.fn() }));
const useNewBlueprintForm = vi.hoisted(() => vi.fn(() => form));
vi.mock('@/features/blueprint/hooks/new-blueprint-form', () => ({ useNewBlueprintForm }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>, useParams: () => ({ owner: 'numina', repo: 'fuse' }), useSearchParams: () => [new URLSearchParams('title=Query+title&base=feature')] }));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: vi.fn() })); vi.mock('@/components/layout/AppHeader', () => ({ default: ({ breadcrumbs }: { breadcrumbs?: ReactNode }) => <header>{breadcrumbs}</header> })); vi.mock('@/components/layout/AppFooter', () => ({ default: () => null }));
import NewBlueprint from '@/pages/NewBlueprint';

describe('NewBlueprint page', () => {
  it('passes route/query defaults and wires project, create, and cancel actions', () => {
    render(<NewBlueprint />); expect(useNewBlueprintForm).toHaveBeenCalledWith({ owner: 'numina', repo: 'fuse', initialTitle: 'Query title', initialBaseBranch: 'feature' });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'New proof' } }); expect(form.setBlueprintTitle).toHaveBeenCalledWith('New proof');
    // Desktop: the workspace runs on the checked-out branch, so there is no
    // base-branch picker to choose from — only a note saying so.
    expect(screen.queryByRole('listbox', { name: 'Base branch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'feature' })).not.toBeInTheDocument();
    expect(screen.getByText(/on the branch that is checked out/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: /Lean project/ }), { target: { value: 'math' } }); expect(form.setLakefileSearchQuery).toHaveBeenCalledWith('math');
    fireEvent.click(screen.getByRole('option', { name: 'Math/lakefile.toml' })); expect(form.selectLakefile).toHaveBeenCalledWith(form.lakefiles[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(form.handleCreate).toHaveBeenCalled(); expect(form.goBack).toHaveBeenCalled();
  });
  it('submits on Enter from the title field', () => {
    render(<NewBlueprint />); fireEvent.keyDown(screen.getByLabelText(/Title/), { key: 'Enter' }); expect(form.handleCreate).toHaveBeenCalled();
  });
  it('omits the hidden-selection message while searching', () => {
    form.lakefileSearchQuery = 'docs';
    form.filteredLakefiles = [];
    try {
      render(<NewBlueprint />);
      expect(screen.queryByText(/Selected project hidden by search/)).not.toBeInTheDocument();
      expect(form.selectedLakefileDir).toBe('Math');
    } finally {
      form.lakefileSearchQuery = '';
      form.filteredLakefiles = form.lakefiles;
    }
  });
});
