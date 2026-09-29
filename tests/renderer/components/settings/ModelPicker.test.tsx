import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ModelOption } from '@shared/desktop';
import { ModelPicker } from '@/components/settings/ModelPicker';
import { resetProviderModels } from '@/hooks/use-provider-models';

const models = vi.fn<(provider: string) => Promise<ModelOption[]>>();

beforeEach(() => {
  resetProviderModels();
  models.mockReset();
  (window as { fuse?: unknown }).fuse = { providers: { models } };
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
    answer([{ value: 'opus', label: 'Opus 5.5' }]);
    await waitFor(() => expect(screen.getByLabelText(/Model/)).toHaveTextContent('Opus 5.5'));
  });

  it('falls back to CLI default and custom names when the CLI cannot be asked', async () => {
    models.mockRejectedValue(new Error('not installed'));
    render(<ModelPicker id="model" provider="codex" value="gpt-6-astra" onCommit={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Custom model')).toHaveValue('gpt-6-astra'));
  });
});
