import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppSettings, ModelOption } from '@shared/desktop';
import { ModelPicker } from '@/components/settings/ModelPicker';

const models = vi.fn<(provider: string) => Promise<ModelOption[]>>();

let settings: AppSettings;
let changed: (settings: AppSettings) => void;

beforeEach(() => {
  models.mockReset();
  settings = { claudePath: '', codexPath: '' } as AppSettings;
  (window as { fuse?: unknown }).fuse = { providers: { models }, settings: {
    get: vi.fn().mockImplementation(() => Promise.resolve(settings)),
    onChanged: vi.fn().mockImplementation(callback => { changed = callback; return vi.fn(); }),
  } };
});

afterEach(() => {
  delete (window as { fuse?: unknown }).fuse;
});

describe('ModelPicker', () => {
  it('lists the models the installed CLI reports', async () => {
    models.mockResolvedValue([{ value: 'opus', label: 'Opus 5.5', description: 'For complex work' }]);
    const onCommit = vi.fn();
    render(<ModelPicker id="model" provider="claude" value="" onCommit={onCommit} />);
    fireEvent.click(screen.getByLabelText(/Model/));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Opus 5.5/ }));
    expect(onCommit).toHaveBeenCalledWith('opus');
    expect(models).toHaveBeenCalledWith('claude');
  });

  it('shows a saved model as itself while the CLI is still answering', async () => {
    let answer!: (value: ModelOption[]) => void;
    models.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    render(<ModelPicker id="model" provider="claude" value="opus" onCommit={vi.fn()} />);
    expect(screen.getByLabelText(/Model/)).toHaveTextContent('opus');
    expect(screen.queryByLabelText('Custom model')).not.toBeInTheDocument();
    await waitFor(() => expect(models).toHaveBeenCalled());
    answer([{ value: 'opus', label: 'Opus 5.5' }]);
    await waitFor(() => expect(screen.getByLabelText(/Model/)).toHaveTextContent('Opus 5.5'));
  });

  it('falls back to CLI default and custom names when the CLI cannot be asked', async () => {
    models.mockRejectedValue(new Error('not installed'));
    render(<ModelPicker id="model" provider="codex" value="gpt-6-astra" onCommit={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Custom model')).toHaveValue('gpt-6-astra'));
    expect(screen.getByRole('status')).toHaveTextContent('Could not load models');
  });

  it('refreshes after a CLI path change and ignores the previous reply', async () => {
    let oldAnswer!: (value: ModelOption[]) => void;
    models.mockReturnValueOnce(new Promise(resolve => { oldAnswer = resolve; }))
      .mockResolvedValue([{ value: 'new', label: 'New CLI model' }]);
    render(<ModelPicker id="model" provider="claude" value="new" onCommit={vi.fn()} />);
    await waitFor(() => expect(models).toHaveBeenCalledTimes(1));
    act(() => changed({ ...settings, claudePath: '/new/claude' }));
    await waitFor(() => expect(screen.getByLabelText(/Model:/)).toHaveTextContent('New CLI model'));
    await act(async () => oldAnswer([{ value: 'old', label: 'Old CLI model' }]));
    expect(screen.getByLabelText(/Model:/)).toHaveTextContent('New CLI model');
    act(() => changed({ ...settings, claudePath: '/new/claude', theme: 'dark' }));
    expect(models).toHaveBeenCalledTimes(2);
  });

  it('re-queries on remount so paths changed while closed are respected', async () => {
    models.mockResolvedValue([{ value: 'opus', label: 'Old label' }]);
    const first = render(<ModelPicker id="model" provider="claude" value="opus" onCommit={vi.fn()} />);
    await screen.findByLabelText('Model: Old label');
    first.unmount();
    models.mockResolvedValue([{ value: 'opus', label: 'New label' }]);
    render(<ModelPicker id="model" provider="claude" value="opus" onCommit={vi.fn()} />);
    await screen.findByLabelText('Model: New label');
    expect(models).toHaveBeenCalledTimes(2);
  });

  it('ignores a late response from the previous provider', async () => {
    let answer!: (value: ModelOption[]) => void;
    models.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }))
      .mockResolvedValue([{ value: 'codex-model', label: 'Codex model' }]);
    const picker = render(<ModelPicker id="model" provider="claude" value="" onCommit={vi.fn()} />);
    await waitFor(() => expect(models).toHaveBeenCalledTimes(1));
    picker.rerender(<ModelPicker id="model" provider="codex" value="codex-model" onCommit={vi.fn()} />);
    await screen.findByLabelText('Model: Codex model');
    await act(async () => answer([{ value: 'opus', label: 'Opus' }]));
    expect(screen.getByLabelText('Model: Codex model')).toBeInTheDocument();
  });

});
