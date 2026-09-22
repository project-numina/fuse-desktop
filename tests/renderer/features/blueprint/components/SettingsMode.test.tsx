import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  deleteBlueprint,
  discoverLakefiles,
  setBlueprintLeanProject,
  fetchWorkspaceBlueprintCandidates,
  setBlueprintSourceFile,
  updateBlueprintSettings,
} from '@/lib/api';

import SettingsMode, { type BlueprintRef } from '@/features/blueprint/components/SettingsMode';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    deleteBlueprint: vi.fn(),
    discoverLakefiles: vi.fn(),
    setBlueprintLeanProject: vi.fn(),
    fetchWorkspaceBlueprintCandidates: vi.fn(),
    setBlueprintSourceFile: vi.fn(),
    updateBlueprintSettings: vi.fn(),
  };
});

const deleteMock = vi.mocked(deleteBlueprint);
const fetchCandidatesMock = vi.mocked(fetchWorkspaceBlueprintCandidates);
const setSourceMock = vi.mocked(setBlueprintSourceFile);
const updateSettingsMock = vi.mocked(updateBlueprintSettings);

const SAVED_RESPONSE = {
  name: 'Froda', description: '', pr_mode: 'off', auto_commit: true,
  orchestrator_child_concurrency: 1, pr_number: null, pr_error: null, pushed: true,
};

function setup(overrides: Partial<React.ComponentProps<typeof SettingsMode>> = {}) {
  const blueprint: BlueprintRef = {
    id: 'froda', name: 'Froda', description: '', pr_mode: 'off', auto_commit: true,
    orchestrator_child_concurrency: 1, open_pr_number: null,
    agent: {
      provider: 'claude', model: '', effort: null,
      claude_permission_mode: 'acceptEdits', codex_sandbox: 'workspace-write',
    },
  };
  const props = {
    blueprint, owner: 'local', repo: 'sample', blueprintId: 'froda',
    onUpdated: vi.fn(), onSourceUpdated: vi.fn(), onRemoved: vi.fn(), ...overrides,
  };
  render(<SettingsMode {...props} />);
  return props;
}

function selectSection(name: string) {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace settings sections' }))
    .getByRole('button', { name }));
}

function selectProvider(name: string) {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Provider' }))
    .getByRole('radio', { name }));
}

function chooseDropdown(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}: `) }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
}

beforeEach(() => {
  deleteMock.mockReset();
  fetchCandidatesMock.mockReset();
  setSourceMock.mockReset();
  updateSettingsMock.mockReset();
  updateSettingsMock.mockResolvedValue(SAVED_RESPONSE as never);
  vi.mocked(discoverLakefiles).mockReset();
  vi.mocked(setBlueprintLeanProject).mockReset();
});

describe('SettingsMode', () => {
  it('keeps blueprint and lakefile selection together in General, discovering projects only on demand', async () => {
    vi.mocked(discoverLakefiles).mockResolvedValue({ lakefiles: [
      { path: 'lean/example/lakefile.toml', directory: 'lean/example', lakefile: 'lakefile.toml' },
    ], truncated: false });
    vi.mocked(setBlueprintLeanProject).mockResolvedValue({ project_subdir: 'lean/example' });
    const beforeProjectChange = vi.fn().mockResolvedValue(true);
    const onProjectUpdated = vi.fn();
    setup({ beforeProjectChange, onProjectUpdated });
    expect(screen.getByText('Blueprint source')).toBeVisible();
    expect(screen.getByText('Lean project (lakefile)')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Blueprint' })).not.toBeInTheDocument();
    expect(discoverLakefiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change lakefile' }));
    await screen.findByRole('button', { name: 'Lakefile: Choose a lakefile' });
    chooseDropdown('Lakefile', 'lean/example/lakefile.toml');
    expect(document.querySelector('select')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use this project' }));
    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalledWith('lean/example'));
    expect(beforeProjectChange).toHaveBeenCalledOnce();
    expect(setBlueprintLeanProject).toHaveBeenCalledWith('local', 'sample', 'froda', 'lean/example/lakefile.toml');
  });

  it('does not switch projects when saving an open file fails', async () => {
    vi.mocked(discoverLakefiles).mockResolvedValue({ lakefiles: [
      { path: 'lakefile.lean', directory: '', lakefile: 'lakefile.lean' },
    ], truncated: false });
    setup({ beforeProjectChange: vi.fn().mockResolvedValue(false) });
    fireEvent.click(screen.getByRole('button', { name: 'Change lakefile' }));
    await screen.findByRole('button', { name: 'Lakefile: lakefile.lean' });
    fireEvent.click(screen.getByRole('button', { name: 'Use this project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save your open file changes');
    expect(setBlueprintLeanProject).not.toHaveBeenCalled();
  });

  it('uses the shared menu dropdown with the current sandbox checked and saves a new selection', async () => {
    updateSettingsMock.mockResolvedValue(SAVED_RESPONSE as never);
    setup();
    selectSection('Agent');
    selectProvider('Codex');
    await waitFor(() => expect(screen.getByLabelText('Sandbox')).toBeVisible());
    expect(document.querySelector('select')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sandbox: Workspace write (default)' }));
    expect(screen.getByRole('menuitemradio', { name: 'Workspace write (default)' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Read only' }));
    await screen.findByRole('button', { name: 'Sandbox: Read only' });
    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledWith(
      'local', 'sample', 'froda', expect.objectContaining({
        agent: expect.objectContaining({ codex_sandbox: 'read-only' }),
      }),
    ));
  });

  it('preserves General drafts without saving them when Agent settings autosave', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New name' } });
    selectSection('Agent');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    chooseDropdown('Permissions', 'Plan only (no edits)');
    await waitFor(() => expect(screen.getByLabelText('Permissions')).toHaveTextContent('Plan only'));
    expect(updateSettingsMock).toHaveBeenCalledWith('local', 'sample', 'froda', {
      agent: expect.objectContaining({ claude_permission_mode: 'plan' }),
    });
    selectSection('General');
    expect(screen.getByLabelText('Name')).toHaveValue('New name');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('requires confirmation and warns when provider safety controls are disabled', async () => {
    setup();
    selectSection('Agent');
    chooseDropdown('Permissions', 'Bypass permissions (dangerous)');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('--dangerously-skip-permissions');
    expect(updateSettingsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable bypass permissions' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('note')).toHaveTextContent('outside the repository');
    selectProvider('Codex');
    await waitFor(() => expect(screen.getByLabelText('Sandbox')).toBeVisible());
    chooseDropdown('Sandbox', 'Full access (dangerous)');
    fireEvent.click(screen.getByRole('button', { name: 'Enable full access' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('note')).toHaveTextContent('outside the repository');
  });

  it('mirrors the blueprint and enables save only for valid changes', () => {
    setup();
    expect(screen.getByLabelText('Name')).toHaveValue('Froda');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Froda renamed' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('offers no automatic commits, including for legacy workspaces', () => {
    setup();
    expect(screen.queryByRole('radiogroup', { name: 'Auto-commit' })).not.toBeInTheDocument();
  });

  it('saves changed name, description and auto-commit without any pull-request field', async () => {
    updateSettingsMock.mockResolvedValue({
      ...SAVED_RESPONSE, name: 'Froda renamed', description: 'desc', auto_commit: false,
    } as never);
    const props = setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Froda renamed ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'desc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledWith(
      'local', 'sample', 'froda', {
        title: 'Froda renamed', description: 'desc',
      },
    ));
    expect(props.onUpdated).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Froda renamed', description: 'desc', auto_commit: false,
    }));
    expect(screen.getByText('Settings saved.')).toBeInTheDocument();
  });

  it('offers no pull-request or parallel-agent controls', () => {
    setup();
    expect(screen.queryByText('Pull request')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Draft' })).not.toBeInTheDocument();
    expect(screen.queryByText('Parallel autonomous agents')).not.toBeInTheDocument();
    expect(screen.queryByText(/GitHub/)).not.toBeInTheDocument();
  });

  describe('agent section', () => {
    it('shows saved custom models and uses the shared picker without a datalist', () => {
      setup({ blueprint: { id: 'froda', name: 'Froda', agent: {
        provider: 'codex', model: 'my-custom-model', effort: 'high',
        claude_permission_mode: 'plan', codex_sandbox: 'read-only',
      } } });
      selectSection('Agent');
      expect(screen.getByLabelText('Custom model')).toHaveValue('my-custom-model');
      expect(screen.getByLabelText('Effort')).toHaveTextContent('high');
      expect(screen.getByLabelText('Sandbox')).toHaveTextContent('Read only');
      expect(document.querySelector('datalist')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    });

    it('uses CLI defaults when the workspace has no agent block', () => {
      setup({ blueprint: { id: 'froda', name: 'Froda' } });
      selectSection('Agent');
      expect(screen.getByLabelText('Model')).toHaveTextContent('CLI default');
      expect(screen.getByLabelText('Effort')).toHaveTextContent('CLI default');
    });

    it('autosaves successive fields without losing earlier selections', async () => {
      const props = setup();
      selectSection('Agent');
      chooseDropdown('Model', 'opus');
      await waitFor(() => expect(screen.getByLabelText('Model')).toHaveTextContent('opus'));
      chooseDropdown('Effort', 'max');
      await waitFor(() => expect(screen.getByLabelText('Effort')).toHaveTextContent('max'));
      expect(updateSettingsMock).toHaveBeenLastCalledWith('local', 'sample', 'froda', {
        agent: expect.objectContaining({ model: 'opus', effort: 'max' }),
      });
      expect(props.onUpdated).toHaveBeenLastCalledWith(expect.objectContaining({
        agent: expect.objectContaining({ model: 'opus', effort: 'max' }),
      }));
    });

    it('saves trimmed custom names on blur, not on every keystroke', async () => {
      setup();
      selectSection('Agent');
      chooseDropdown('Model', 'Custom model…');
      fireEvent.change(screen.getByLabelText('Custom model'), { target: { value: ' my-model ' } });
      expect(updateSettingsMock).not.toHaveBeenCalled();
      fireEvent.blur(screen.getByLabelText('Custom model'));
      await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledWith(
        'local', 'sample', 'froda', { agent: expect.objectContaining({ model: 'my-model' }) },
      ));
      await waitFor(() => expect(screen.getByLabelText('Custom model')).toHaveValue('my-model'));
    });

    it('switches to Codex suggestions and sandbox controls after saving the provider', async () => {
      setup();
      selectSection('Agent');
      selectProvider('Codex');
      await waitFor(() => expect(screen.getByLabelText('Sandbox')).toBeVisible());
      fireEvent.click(screen.getByLabelText('Model'));
      expect(screen.getByRole('menuitemradio', { name: 'gpt-5.6-sol' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitemradio', { name: 'opus' })).not.toBeInTheDocument();
    });

    it('ignores a late response after navigating to another workspace', async () => {
      let resolve!: (value: never) => void;
      updateSettingsMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      const onUpdated = vi.fn();
      const props = { owner: 'local', repo: 'sample', blueprintId: 'first', onUpdated };
      const { rerender } = render(<SettingsMode {...props} blueprint={{ id: 'first', name: 'First' }} />);
      selectSection('Agent');
      chooseDropdown('Model', 'opus');
      rerender(<SettingsMode {...props} blueprintId="second" blueprint={{ id: 'second', name: 'Second' }} />);
      selectSection('Agent');
      resolve(SAVED_RESPONSE as never);
      await waitFor(() => expect(screen.getByLabelText('Model')).toBeEnabled());
      expect(screen.getByLabelText('Model')).toHaveTextContent('CLI default');
      expect(onUpdated).not.toHaveBeenCalled();
    });

    it('retains the saved selection on failure and allows retry', async () => {
      updateSettingsMock.mockRejectedValueOnce(new Error('failed'));
      setup();
      selectSection('Agent');
      chooseDropdown('Model', 'opus');
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not save settings');
      expect(screen.getByLabelText('Model')).toHaveTextContent('CLI default');
      chooseDropdown('Model', 'opus');
      await waitFor(() => expect(screen.getByLabelText('Model')).toHaveTextContent('opus'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('disables agent controls while saving and confirms dangerous permissions before persisting', async () => {
      let resolve!: (value: never) => void;
      updateSettingsMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      setup();
      selectSection('Agent');
      chooseDropdown('Permissions', 'Bypass permissions (dangerous)');
      expect(updateSettingsMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Enable bypass permissions' }));
      expect(screen.getByLabelText('Model')).toBeDisabled();
      expect(document.querySelector('[role="radio"][aria-checked="false"]')).toBeDisabled();
      resolve(SAVED_RESPONSE as never);
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.getByLabelText('Model')).toBeEnabled();
    });
  });

  it('maps API failures to safe messages', async () => {
    updateSettingsMock.mockRejectedValue(new ApiError('private traceback', 403));
    setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('You do not have permission to update this blueprint.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/private traceback/)).not.toBeInTheDocument();
  });

  it('locks settings, source changes and removal for read-only workspaces', () => {
    setup({ readonly: true });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    selectSection('General');
    expect(screen.getByRole('button', { name: 'Change' })).toBeDisabled();
    selectSection('General');
    expect(screen.getByRole('button', { name: 'Remove workspace' })).toBeDisabled();
    expect(screen.getByLabelText('Model')).toBeDisabled();
    expect(screen.getByLabelText('Effort')).toBeDisabled();
    expect(screen.getByLabelText('Permissions')).toBeDisabled();
    expect(screen.getByLabelText('Sandbox')).toBeDisabled();
    expect(screen.getByText('This workspace is read-only.')).toBeInTheDocument();
  });

  it('shows the supplied ownership reason for a read-only workspace', () => {
    setup({
      readonly: true,
      readonlyReason: 'Only the user who created this workspace can edit it.',
    });
    expect(screen.getByText(/only the user who created this workspace/i))
      .toBeInTheDocument();
  });

  describe('remove workspace', () => {
    it('uses the shared outlined destructive button style', () => {
      setup();
      expect(screen.getByRole('button', { name: 'Remove workspace' }))
        .toHaveClass('btn-outline-destructive', 'px-4', 'py-2');
    });

    it('asks for confirmation, deletes, and hands navigation to the page', async () => {
      deleteMock.mockResolvedValue(null);
      const props = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent('Remove this workspace?');
      expect(dialog).toHaveTextContent('Files in the folder are not deleted.');
      expect(deleteMock).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove workspace' }));
      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('local', 'sample', 'froda'));
      await waitFor(() => expect(props.onRemoved).toHaveBeenCalledOnce());
    });

    it('cancelling the dialog removes nothing', async () => {
      const props = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(deleteMock).not.toHaveBeenCalled();
      expect(props.onRemoved).not.toHaveBeenCalled();
    });

    it('surfaces a 409 reason verbatim and keeps the workspace', async () => {
      deleteMock.mockRejectedValue(
        new ApiError('Cannot delete a blueprint with active agent sessions.', 409),
      );
      const props = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove workspace' }));
      expect(await screen.findByText('Cannot delete a blueprint with active agent sessions.'))
        .toBeInTheDocument();
      expect(props.onRemoved).not.toHaveBeenCalled();
    });

    it('hides other failure details behind a generic message', async () => {
      deleteMock.mockRejectedValue(new ApiError('private traceback', 500));
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove workspace' }));
      expect(await screen.findByText('Could not remove this workspace. Please try again.'))
        .toBeInTheDocument();
      expect(screen.queryByText(/private traceback/)).not.toBeInTheDocument();
    });
  });

  it('loads, filters, and adopts an existing blueprint source', async () => {
    fetchCandidatesMock.mockResolvedValue({ files: [
      { path: 'blueprint/src/content.tex', name: 'content.tex', size: 100 },
      { path: 'docs/blueprint.tex', name: 'blueprint.tex', size: 200 },
    ] });
    const payload = {
      blueprint_file: 'docs/blueprint.tex', included_files: ['docs/blueprint.tex'], entry_count: 7,
    };
    setSourceMock.mockResolvedValue(payload);
    const props = setup();
    selectSection('General');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    expect(fetchCandidatesMock).toHaveBeenCalledWith('local', 'sample', 'froda');
    fireEvent.change(within(dialog).getByPlaceholderText('Search .tex files…'), {
      target: { value: 'docs' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: /blueprint\.tex/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this file' }));
    await waitFor(() => expect(setSourceMock).toHaveBeenCalledWith(
      'local', 'sample', 'froda', 'docs/blueprint.tex',
    ));
    expect(props.onSourceUpdated).toHaveBeenCalledWith(payload);
    expect(screen.getByText('Source updated — 7 declarations')).toBeInTheDocument();
  });

  it('reports candidate and invalid-source failures safely', async () => {
    fetchCandidatesMock.mockResolvedValue({ files: [
      { path: 'docs/empty.tex', name: 'empty.tex', size: 10 },
    ] });
    setSourceMock.mockRejectedValue(new ApiError('private', 422));
    setup();
    selectSection('General');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const radio = await screen.findByRole('radio', { name: /empty\.tex/ });
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole('button', { name: 'Use this file' }));
    expect(await screen.findByText(
      'That file has no leanblueprint declarations Fuse can parse.',
    )).toBeInTheDocument();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });
});
