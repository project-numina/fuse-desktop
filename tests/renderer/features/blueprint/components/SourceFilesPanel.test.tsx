import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteRepositorySource,
  importRepositorySource,
  type RepositoryFileEntry,
  type RepositorySource,
} from '@/lib/api';

import SourceFilesPanel from '@/features/blueprint/components/SourceFilesPanel';

vi.mock('@/lib/api', () => ({
  deleteRepositorySource: vi.fn(),
  importRepositorySource: vi.fn(),
}));
vi.mock('@/features/blueprint/components/AddSourceDialog', () => ({
  default: ({ open, repositoryAction, excludedRepoPaths, onUploaded, onSelectRepoFile }: {
    open: boolean;
    repositoryAction: string;
    excludedRepoPaths?: string[];
    onUploaded: (source: RepositorySource) => void;
    onSelectRepoFile: (file: RepositoryFileEntry) => void | Promise<void>;
  }) => (
    <div
      data-testid="add-source-dialog"
      data-open={open}
      data-repository-action={repositoryAction}
      data-excluded-repo-paths={(excludedRepoPaths ?? []).join(',')}
    >
      <button type="button" onClick={() => onUploaded(source({ id: 'uploaded' }))}>Emit upload</button>
      <button type="button" onClick={() => onSelectRepoFile({
        path: 'docs/paper.tex', name: 'paper.tex', size: 12,
      })}>Emit repository file</button>
    </div>
  ),
}));
vi.mock('@/features/blueprint/components/ConfirmDialog', () => ({
  default: ({ open, message, onConfirm, onCancel }: {
    open: boolean; message: string; onConfirm: () => void; onCancel: () => void;
  }) => open ? (
    <div role="alertdialog">
      {message}
      <button type="button" onClick={onConfirm}>Confirm delete</button>
      <button type="button" onClick={onCancel}>Cancel delete</button>
    </div>
  ) : null,
}));

const deleteSourceMock = vi.mocked(deleteRepositorySource);
const importSourceMock = vi.mocked(importRepositorySource);

function source(overrides: Partial<RepositorySource> = {}): RepositorySource {
  return {
    id: 'source-1', github_repo_id: 1, owner: 'owner', repo_name: 'repo',
    display_name: 'paper.tex', source_type: 'latex', status: 'ready', artifacts: ['original'],
    metadata: {}, created_at: '2026-06-16T00:00:00Z', updated_at: '2026-06-16T00:00:00Z',
    ...overrides,
  } as RepositorySource;
}

function setup(overrides: Partial<React.ComponentProps<typeof SourceFilesPanel>> = {}) {
  const props = {
    sources: [source()], selectedSourceId: 'source-1', owner: 'owner', repository: 'repo',
    blueprintId: 'froda', onSelectSource: vi.fn(), onToggleCollapsed: vi.fn(),
    onUploaded: vi.fn(), onDeleted: vi.fn(), ...overrides,
  };
  render(<SourceFilesPanel {...props} />);
  return props;
}

beforeEach(() => {
  deleteSourceMock.mockReset();
  importSourceMock.mockReset();
  importSourceMock.mockResolvedValue(source({
    id: 'imported',
    display_name: 'docs/paper.tex',
    metadata: { repository_path: 'docs/paper.tex' },
  }));
});

describe('SourceFilesPanel', () => {
  it('renders loading, error, and empty states', () => {
    const { rerender } = render(<SourceFilesPanel loading />);
    expect(screen.getByText('Loading sources...')).toBeInTheDocument();
    rerender(<SourceFilesPanel error />);
    expect(screen.getByText('Could not load repository sources.')).toBeInTheDocument();
    rerender(<SourceFilesPanel sources={[]} />);
    expect(screen.getByText('No source files yet.')).toBeInTheDocument();
  });

  it('selects rows and shows transient OCR status badges', () => {
    const props = setup({ sources: [
      source({ id: 'running', display_name: 'scan.pdf', status: 'ocr_running' }),
      source({ id: 'failed', display_name: 'bad.pdf', status: 'failed' }),
      source({ id: 'ready', display_name: 'ready.tex', status: 'ready' }),
    ] });
    expect(screen.getByText('OCR')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ready.tex'));
    expect(props.onSelectSource).toHaveBeenCalledWith('ready');
  });

  it('opens the shared add-source dialog directly', () => {
    setup();
    const addButton = screen.getByRole('button', { name: 'Add' });
    expect(addButton).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(addButton);
    expect(screen.getByTestId('add-source-dialog')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('add-source-dialog')).toHaveAttribute(
      'data-repository-action',
      'import',
    );
  });

  it('forwards uploaded sources from the modal', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Emit upload' }));
    expect(props.onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'uploaded' }));
  });

  it('imports repository files into managed sources', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Emit repository file' }));
    await waitFor(() => expect(importSourceMock).toHaveBeenCalledWith(
      'owner', 'repo', 'froda', 'docs/paper.tex',
    ));
    expect(props.onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'imported' }),
    );
  });

  it('keeps imported paths available for an in-place refresh', () => {
    setup({
      sources: [source({ metadata: { repository_path: 'docs/paper.tex' } })],
    });

    expect(screen.getByTestId('add-source-dialog')).toHaveAttribute(
      'data-excluded-repo-paths',
      '',
    );
  });

  it('confirms workspace-scoped deletion and reports success', async () => {
    deleteSourceMock.mockResolvedValue(undefined as never);
    const props = setup({ sources: [source({ metadata: { project_scoped: true } })] });
    fireEvent.click(screen.getByTitle('Delete source'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('removed for this workspace');
    expect(deleteSourceMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(deleteSourceMock).toHaveBeenCalledWith(
      'owner', 'repo', 'source-1', 'froda',
    ));
    expect(props.onDeleted).toHaveBeenCalledWith('source-1');
  });

  it('hides deletion for legacy repository-backed sources', () => {
    render(
      <SourceFilesPanel sources={[source({ metadata: { legacy: true } })]} />,
    );
    expect(screen.queryByTitle('Delete source')).not.toBeInTheDocument();
  });

  it('hides source-management actions in read-only workspaces', () => {
    setup({ readonly: true });
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete source')).not.toBeInTheDocument();
  });

  it('collapses to an accessible edge handle', () => {
    const props = setup({ collapsed: true });
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show sources panel' }));
    expect(props.onToggleCollapsed).toHaveBeenCalledOnce();
  });
});
