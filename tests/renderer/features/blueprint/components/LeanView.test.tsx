import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeanView, { type LeanViewProps } from '@/features/blueprint/components/LeanView';

vi.mock('@/features/blueprint/components/FileViewer', () => ({ default: ({ onReload }: { onReload?: () => void }) => <div>File content{onReload && <button onClick={onReload}>Reload</button>}</div> }));
vi.mock('@/features/blueprint/components/ChangedFilesPanel', () => ({ default: () => null }));

function props(): LeanViewProps {
  return {
    blueprint: { all_lean_files: ['A.lean'] }, selectedFile: 'A.lean',
    onSelectedFileChange: vi.fn(), onReloadFile: vi.fn(), onSetupLean: vi.fn(),
    panelCollapsed: true, panelWidth: 300,
    onPanelCollapsedChange: vi.fn(), onPanelResizeStart: vi.fn(),
    infoview: { state: {
      goals: [], goalsBefore: [], goalsAfter: [], expectedType: '', lineContext: '',
      diagnostics: [], diagnosticsIncomplete: false, loading: false,
      error: 'Set up Lean to enable live checking.', setupRequired: true,
    } },
  };
}

describe('LeanView setup requirement', () => {
  it('shows a persistent setup action beside the file instead of a nonfunctional Reload', () => {
    const options = props();
    render(<LeanView {...options} />);
    expect(screen.getByRole('status')).toHaveTextContent('Set up Lean to enable live checking');
    expect(screen.getByText('File content')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up Lean' }));
    expect(options.onSetupLean).toHaveBeenCalledOnce();
    expect(options.onReloadFile).not.toHaveBeenCalled();
  });

  it('restores Reload and removes the notice when Lean is ready', () => {
    const options = props();
    const { rerender } = render(<LeanView {...options} />);
    rerender(<LeanView {...options} infoview={{ state: { ...options.infoview!.state, error: null, setupRequired: false } }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(options.onReloadFile).toHaveBeenCalledOnce();
  });
});
