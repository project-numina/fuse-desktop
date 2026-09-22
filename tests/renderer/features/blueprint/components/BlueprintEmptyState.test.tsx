import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  createBlueprint,
  fetchWorkspaceBlueprintCandidates,
  setBlueprintSourceFile,
} from '@/lib/api';

import BlueprintEmptyState from '@/features/blueprint/components/BlueprintEmptyState';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    createBlueprint: vi.fn(),
    fetchWorkspaceBlueprintCandidates: vi.fn(),
    setBlueprintSourceFile: vi.fn(),
  };
});

const createBlueprintMock = vi.mocked(createBlueprint);
const fetchCandidatesMock = vi.mocked(fetchWorkspaceBlueprintCandidates);
const setSourceFileMock = vi.mocked(setBlueprintSourceFile);

function setup(overrides: Partial<React.ComponentProps<typeof BlueprintEmptyState>> = {}) {
  const onBlueprintReady = vi.fn();
  render(
    <BlueprintEmptyState
      owner="numina"
      repo="lean-agent-app"
      blueprintId="froda"
      onBlueprintReady={onBlueprintReady}
      {...overrides}
    />,
  );
  return onBlueprintReady;
}

beforeEach(() => {
  createBlueprintMock.mockReset();
  fetchCandidatesMock.mockReset();
  setSourceFileMock.mockReset();
});

describe('BlueprintEmptyState', () => {
  it('offers both ways to initialize a blueprint', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'No blueprint yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a new blueprint' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Select an existing blueprint' })).toBeEnabled();
  });

  it('hides initialization actions when the workspace is read-only', () => {
    setup({
      readonly: true,
      readonlyMessage: 'Only the creator can edit this workspace.',
    });
    expect(screen.getByText('Only the creator can edit this workspace.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a new blueprint' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select an existing blueprint' }))
      .not.toBeInTheDocument();
  });

  it('requires confirmation, supports cancel, and creates on confirmation', async () => {
    const payload = {
      blueprint_file: 'blueprint/src/content.tex',
      included_files: ['blueprint/src/content.tex'],
      entry_count: 0,
    };
    createBlueprintMock.mockResolvedValue(payload);
    const onBlueprintReady = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new blueprint' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent("can't be undone");
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(createBlueprintMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create a new blueprint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create blueprint' }));
    await waitFor(() => expect(createBlueprintMock).toHaveBeenCalledWith(
      'numina', 'lean-agent-app', 'froda',
    ));
    expect(onBlueprintReady).toHaveBeenCalledWith(payload);
  });

  it('describes creation in local-folder terms without promising a commit', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new blueprint' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      "Fuse will scaffold a new leanblueprint at blueprint/src/content.tex in this folder. This can't be undone.",
    );
    expect(dialog).not.toHaveTextContent(/commit|branch/);
  });

  it('shows a specific folder-not-ready creation error', async () => {
    createBlueprintMock.mockRejectedValue(new ApiError('private', 409));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new blueprint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create blueprint' }));
    expect(await screen.findByText("The folder isn't ready yet. Try again in a moment."))
      .toBeInTheDocument();
  });

  it('reports a vanished adopt candidate in local-folder terms', async () => {
    fetchCandidatesMock.mockResolvedValue({ files: [
      { path: 'docs/blueprint.tex', name: 'blueprint.tex', size: 200 },
    ] });
    setSourceFileMock.mockRejectedValue(new ApiError('missing', 404));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select an existing blueprint' }));
    fireEvent.click(await screen.findByRole('radio', { name: /blueprint\.tex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this file' }));
    expect(await screen.findByText('That file no longer exists in this folder.')).toBeInTheDocument();
  });

  it('loads, filters, and adopts an existing blueprint source', async () => {
    fetchCandidatesMock.mockResolvedValue({ files: [
      { path: 'blueprint/src/content.tex', name: 'content.tex', size: 100 },
      { path: 'docs/blueprint.tex', name: 'blueprint.tex', size: 200 },
    ] });
    const payload = {
      blueprint_file: 'docs/blueprint.tex', included_files: ['docs/blueprint.tex'], entry_count: 9,
    };
    setSourceFileMock.mockResolvedValue(payload);
    const onBlueprintReady = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select an existing blueprint' }));
    expect(await screen.findByRole('radio', { name: /blueprint\.tex/ })).toBeInTheDocument();
    expect(fetchCandidatesMock).toHaveBeenCalledWith('numina', 'lean-agent-app', 'froda');
    fireEvent.change(screen.getByPlaceholderText('Search .tex files…'), {
      target: { value: 'docs' },
    });
    expect(screen.queryByRole('radio', { name: /content\.tex/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /blueprint\.tex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this file' }));
    await waitFor(() => expect(setSourceFileMock).toHaveBeenCalledWith(
      'numina', 'lean-agent-app', 'froda', 'docs/blueprint.tex',
    ));
    expect(onBlueprintReady).toHaveBeenCalledWith(payload);
  });

  it('reports candidate-loading and invalid-source failures', async () => {
    fetchCandidatesMock.mockRejectedValueOnce(new Error('offline'));
    const onBlueprintReady = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select an existing blueprint' }));
    expect(await screen.findByText('Could not load .tex files from the repository.'))
      .toBeInTheDocument();
    expect(onBlueprintReady).not.toHaveBeenCalled();
  });
});
