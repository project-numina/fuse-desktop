import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChangedFilesPanelView from '@/features/blueprint/components/ChangedFilesPanelView';

describe('ChangedFilesPanelView', () => {
  it('shows the collapse handle and invokes the toggle action', () => {
    const onToggleCollapsed = vi.fn();
    render(
      <ChangedFilesPanelView
        collapsed
        rail={false}
        filesPane={<div>files pane</div>}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    expect(screen.queryByText('files pane')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show files panel' }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('keeps both tab panes mounted while switching visibility', () => {
    render(
      <ChangedFilesPanelView
        collapsed={false}
        rail={false}
        filesPane={<div>files pane</div>}
        infoview={<div>proof goals</div>}
        onToggleCollapsed={vi.fn()}
      />,
    );
    const filesPane = screen.getByText('files pane').parentElement as HTMLElement;
    const proofPane = screen.getByText('proof goals').parentElement as HTMLElement;
    expect(filesPane).not.toHaveClass('hidden');
    expect(proofPane).toHaveClass('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Infoview' }));
    expect(filesPane).toHaveClass('hidden');
    expect(proofPane).not.toHaveClass('hidden');
  });

  it('uses the default Infoview hint and hides the edge control in rail mode', () => {
    render(
      <ChangedFilesPanelView
        collapsed={false}
        rail
        filesPane={<div>files pane</div>}
        onToggleCollapsed={vi.fn()}
      />,
    );
    expect(screen.getByText(/Select a Lean file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide panel' })).toHaveClass('hidden');
  });
});
