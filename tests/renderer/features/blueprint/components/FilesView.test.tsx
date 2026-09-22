import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeanView, { type LeanViewProps } from '@/features/blueprint/components/LeanView';

vi.mock('@/features/blueprint/components/FileViewer', () => ({ default: () => <div>Preview</div> }));

const props: LeanViewProps = {
  blueprint: { project_subdir: 'lean/project', all_lean_files: ['lean/project/Main.lean'] },
  files: ['README.md', 'paper.pdf', 'lean/project/Main.lean', 'docs/notes.tex'],
  selectedFile: 'README.md', onSelectedFileChange: vi.fn(),
  panelCollapsed: false, panelWidth: 300, onPanelCollapsedChange: vi.fn(), onPanelResizeStart: vi.fn(),
  infoview: { state: { goals: [], goalsBefore: [], goalsAfter: [], expectedType: '', lineContext: '',
    diagnostics: [], diagnosticsIncomplete: false, loading: false, error: null, setupRequired: true } },
};

describe('Files workspace', () => {
  it('only shows the selected project, without a scope selector, even when an outside file is selected', () => {
    const onDirectoryChange = vi.fn();
    const view = render(<LeanView {...props} selectedFile={null} onDirectoryChange={onDirectoryChange} />);
    expect(screen.getByText('Main.lean')).toBeVisible();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Browse files in/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Whole repository')).not.toBeInTheDocument();
    expect(onDirectoryChange).toHaveBeenLastCalledWith('lean/project');
    view.rerender(<LeanView {...props} onDirectoryChange={onDirectoryChange} />);
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
    expect(screen.getByText('Main.lean')).toBeVisible();
    expect(onDirectoryChange).toHaveBeenLastCalledWith('lean/project');
  });

  it('changes the visible root when the selected project changes', () => {
    const onDirectoryChange = vi.fn();
    const view = render(<LeanView {...props} selectedFile={null} onDirectoryChange={onDirectoryChange} />);
    view.rerender(<LeanView {...props} selectedFile={null} blueprint={{ project_subdir: 'docs' }} onDirectoryChange={onDirectoryChange} />);
    expect(screen.getByText('notes.tex')).toBeVisible();
    expect(screen.queryByText('Main.lean')).not.toBeInTheDocument();
    expect(onDirectoryChange).toHaveBeenLastCalledWith('docs');
    view.rerender(<LeanView {...props} selectedFile={null} blueprint={{ project_subdir: '' }} onDirectoryChange={onDirectoryChange} />);
    expect(screen.getByText('README.md')).toBeVisible();
    expect(onDirectoryChange).toHaveBeenLastCalledWith('');
  });

  it('shows the repository when the project is at its root and hides Lean-only controls for documents', () => {
    render(<LeanView {...props} blueprint={{ project_subdir: '' }} />);
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('paper.pdf')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('lean')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Infoview' })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'paper.pdf' }), { key: 'Enter' });
    expect(props.onSelectedFileChange).toHaveBeenCalledWith('paper.pdf');
  });

  it('keeps Infoview open on non-Lean files without showing stale Lean diagnostics', () => {
    const view = render(<LeanView {...props} selectedFile="lean/project/Main.lean" />);
    expect(screen.getByRole('button', { name: 'Infoview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Infoview' }));
    expect(screen.getByText('Set up Lean to enable proof goals and live checking.')).toBeVisible();
    view.rerender(<LeanView {...props} />);
    expect(screen.getByRole('button', { name: 'Infoview' })).toBeVisible();
    expect(screen.getByText('Select a Lean file to view proof goals and diagnostics.')).toBeVisible();
    expect(screen.queryByText('Set up Lean to enable proof goals and live checking.')).not.toBeInTheDocument();
    view.rerender(<LeanView {...props} selectedFile="lean/project/Main.lean" />);
    expect(screen.getByText('Set up Lean to enable proof goals and live checking.')).toBeVisible();
  });

  it('offers Infoview before a file is selected or language services are available', () => {
    render(<LeanView {...props} selectedFile={null} infoview={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Infoview' }));
    expect(screen.getByText('Select a Lean file to view proof goals and diagnostics.')).toBeVisible();
  });

  it('keeps imported references in the same workspace without a second source panel', () => {
    render(<LeanView {...props} selectedFile={null} referencePreview={<p>Saved paper preview</p>}
      filePanelFooter={<button>Imported references</button>} />);
    expect(screen.getByText('Saved paper preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imported references' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Infoview' }));
    expect(screen.getByText('Select a Lean file to view proof goals and diagnostics.')).toBeVisible();
  });
});
