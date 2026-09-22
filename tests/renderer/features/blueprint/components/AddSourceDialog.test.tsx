import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRepositoryFiles,
  type RepositorySource,
} from '@/lib/api';

import AddSourceDialog from '@/features/blueprint/components/AddSourceDialog';

vi.mock('@/lib/api', () => ({
  fetchRepositoryFiles: vi.fn(),
}));

vi.mock('@/features/blueprint/components/SourceUploadModal', () => ({
  default: ({ open, mode, onUploaded }: {
    open: boolean;
    mode: 'upload' | 'write';
    onUploaded: (source: RepositorySource) => void;
  }) => open ? (
    <div data-testid="source-upload-modal" data-mode={mode}>
      <button type="button" onClick={() => onUploaded({
        id: 'uploaded',
        display_name: 'paper.pdf',
        source_type: 'pdf',
        artifacts: ['original'],
      } as RepositorySource)}>
        Finish source
      </button>
    </div>
  ) : null,
}));

const fetchFiles = vi.mocked(fetchRepositoryFiles);

function setup(overrides: Partial<React.ComponentProps<typeof AddSourceDialog>> = {}) {
  const props = {
    open: true,
    owner: 'project-numina',
    repository: 'numina',
    blueprintId: 'blueprint-editor',
    onOpenChange: vi.fn(),
    onUploaded: vi.fn(),
    onSelectRepoFile: vi.fn(),
    ...overrides,
  };
  render(<AddSourceDialog {...props} />);
  return props;
}

beforeEach(() => {
  fetchFiles.mockReset();
  fetchFiles.mockResolvedValue({
    files: [
      { path: 'README.md', name: 'README.md', size: 10 },
      { path: 'src/Main.lean', name: 'Main.lean', size: 20 },
      { path: 'src/nested/Proof.lean', name: 'Proof.lean', size: 30 },
      { path: 'docs/paper.tex', name: 'paper.tex', size: 40 },
    ],
    truncated: false,
    clone_ready: true,
  });
});

describe('AddSourceDialog', () => {
  it('starts with the three source type choices', () => {
    setup();
    expect(screen.getByRole('button', { name: /Upload a source/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Write a source/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose from repository/ })).toBeInTheDocument();
  });

  it.each([
    ['Upload a source', 'upload'],
    ['Write a source', 'write'],
  ] as const)('keeps the existing %s flow', (choice, mode) => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(choice) }));
    expect(screen.getByTestId('source-upload-modal')).toHaveAttribute('data-mode', mode);
  });

  it('forwards a completed upload and closes the flow', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Upload a source/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish source' }));
    expect(props.onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'uploaded' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('browses folders and selects an existing repository file', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));

    await waitFor(() => expect(fetchFiles).toHaveBeenCalledWith(
      'project-numina',
      'numina',
      'blueprint-editor',
    ));
    fireEvent.click(await screen.findByRole('button', { name: 'src' }));
    fireEvent.click(screen.getByRole('button', { name: 'Main.lean' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.onSelectRepoFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/Main.lean' }),
    );
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('searches by full path and hides files that are already attached', async () => {
    setup({ excludedRepoPaths: ['README.md'] });
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));
    await screen.findByRole('button', { name: 'src' });
    expect(screen.queryByRole('button', { name: 'README.md' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search repository files' }), {
      target: { value: 'nested/proof' },
    });
    expect(screen.getByRole('button', { name: /src\/nested\/Proof\.lean/ })).toBeInTheDocument();
  });

  it('explains when the workspace clone is not ready', async () => {
    fetchFiles.mockResolvedValue({ files: [], truncated: false, clone_ready: false });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));
    expect(
      await screen.findByText('Repository files will be available once the workspace has loaded.'),
    ).toBeInTheDocument();
  });

  it('limits repository imports to managed source formats', async () => {
    setup({ repositoryAction: 'import' });
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));

    expect(screen.getByText(/Select a LaTeX, Markdown, or PDF file from/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument();
  });

  it('keeps the repository browser open when adding fails', async () => {
    const onSelectRepoFile = vi.fn().mockRejectedValue(new Error('Could not import file.'));
    const props = setup({ repositoryAction: 'import', onSelectRepoFile });
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'README.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Could not import file.')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('announces selection state and locks repository actions while adding', async () => {
    let finish!: () => void;
    const onSelectRepoFile = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const props = setup({ onSelectRepoFile });
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));
    const file = await screen.findByRole('button', { name: 'README.md' });
    expect(file).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(file);
    expect(file).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish();
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows the stable fallback when repository loading fails without a message', async () => {
    fetchFiles.mockRejectedValue({});
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));
    expect(await screen.findByText('Could not load repository files.')).toBeInTheDocument();
  });

  it('states that searches only cover the truncated file list', async () => {
    fetchFiles.mockResolvedValue({
      files: [{ path: 'README.md', name: 'README.md', size: 10 }],
      truncated: true,
      clone_ready: true,
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Choose from repository/ }));

    expect(
      await screen.findByText('Only the first 5,000 repository files are shown.'),
    ).toBeInTheDocument();
  });
});
