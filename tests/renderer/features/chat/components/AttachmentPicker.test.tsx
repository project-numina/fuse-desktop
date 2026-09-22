import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRepositoryFiles,
  fetchRepositorySources,
  type RepositorySource,
} from '@/lib/api';

import AttachmentPicker from '@/features/chat/components/AttachmentPicker';

vi.mock('@/lib/api', () => ({
  fetchRepositoryFiles: vi.fn(),
  fetchRepositorySources: vi.fn(),
}));

const fetchFiles = vi.mocked(fetchRepositoryFiles);
const fetchSources = vi.mocked(fetchRepositorySources);

function source(overrides: Partial<RepositorySource> = {}): RepositorySource {
  return {
    id: 'source-1', display_name: 'Paper.tex', source_type: 'latex', artifacts: ['latex'],
    ...overrides,
  } as RepositorySource;
}

const baseProps = {
  open: true,
  owner: 'owner',
  repository: 'repo',
  blueprintId: 'blueprint',
  selectedSourceIds: [] as string[],
  onClose: vi.fn(),
  onSelectSource: vi.fn(),
  onRequestAddSource: vi.fn(),
};

beforeEach(() => {
  fetchFiles.mockReset();
  fetchSources.mockReset();
  fetchSources.mockResolvedValue({ sources: [source()] });
});

describe('AttachmentPicker', () => {
  it('loads scoped sources and selects an available result', async () => {
    const onSelectSource = vi.fn();
    render(<AttachmentPicker {...baseProps} onSelectSource={onSelectSource} />);
    expect(await screen.findByRole('button', { name: 'Paper.tex' })).toBeInTheDocument();
    expect(fetchSources).toHaveBeenCalledWith('owner', 'repo', 'blueprint');
    fireEvent.click(screen.getByRole('button', { name: 'Paper.tex' }));
    expect(onSelectSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'source-1' }));
  });

  it('filters selected sources and requests the shared add-source dialog', async () => {
    const onRequestAddSource = vi.fn();
    render(<AttachmentPicker
      {...baseProps}
      selectedSourceIds={['source-1']}
      onRequestAddSource={onRequestAddSource}
    />);
    await waitFor(() => expect(fetchSources).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Paper.tex' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(onRequestAddSource).toHaveBeenCalledOnce();
  });

  it('updates immediately from the page-level source list', async () => {
    const { rerender } = render(<AttachmentPicker {...baseProps} sources={[]} />);
    expect(screen.getByText('No sources')).toBeInTheDocument();
    expect(fetchSources).not.toHaveBeenCalled();

    rerender(<AttachmentPicker
      {...baseProps}
      sources={[source({ id: 'source-2', display_name: 'Fresh.pdf' })]}
    />);
    expect(screen.getByRole('button', { name: 'Fresh.pdf' })).toBeInTheDocument();
  });

  it('keeps repository files out of the quick picker', async () => {
    render(<AttachmentPicker {...baseProps} />);
    await waitFor(() => expect(fetchSources).toHaveBeenCalled());
    expect(fetchFiles).not.toHaveBeenCalled();
  });
});
