import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SourceFilePickerDialog, {
  type SourceFilePickerDialogProps,
} from '@/features/blueprint/components/SourceFilePickerDialog';

const files = [
  { path: 'blueprint/src/Main.tex', name: 'Main.tex', size: 120 },
  { path: 'blueprint/appendix/Proofs.tex', name: 'Proofs.tex', size: 240 },
];

function setup(overrides: Partial<SourceFilePickerDialogProps> = {}) {
  const props: SourceFilePickerDialogProps = {
    open: true,
    files,
    selectedPath: null,
    description: 'Pick the LaTeX file that defines this blueprint.',
    savingLabel: 'Attaching…',
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  const view = render(<SourceFilePickerDialog {...props} />);
  return { ...view, props };
}

describe('SourceFilePickerDialog', () => {
  it('does not render dialog content while closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders loading, empty-error, and empty-success states', () => {
    const { rerender, props } = setup({ files: [], loading: true });

    expect(screen.getByRole('dialog')).toHaveTextContent('Loading .tex files…');
    expect(screen.queryByRole('button', { name: 'Use this file' })).not.toBeInTheDocument();

    rerender(<SourceFilePickerDialog {...props} loading={false} error="Discovery failed." />);
    expect(screen.getByText('Discovery failed.')).toHaveClass('text-destructive');
    expect(screen.queryByText(/No leanblueprint/)).not.toBeInTheDocument();

    rerender(<SourceFilePickerDialog {...props} loading={false} error={null} />);
    expect(screen.getByText(/No leanblueprint .tex files found/)).toBeVisible();
  });

  it('filters by path or name and reports selection and confirmation', () => {
    const { props, rerender } = setup();

    expect(screen.getByRole('heading', { name: 'Choose a blueprint source' })).toBeVisible();
    expect(screen.getByText('Pick the LaTeX file that defines this blueprint.')).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Use this file' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Search .tex files…'), {
      target: { value: 'APPENDIX' },
    });
    expect(screen.getByRole('radio', { name: /Proofs\.tex/ })).toBeVisible();
    expect(screen.queryByRole('radio', { name: /Main\.tex/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Proofs\.tex/ }));
    expect(props.onSelect).toHaveBeenCalledWith('blueprint/appendix/Proofs.tex');

    rerender(
      <SourceFilePickerDialog
        {...props}
        selectedPath="blueprint/appendix/Proofs.tex"
      />,
    );
    const selected = screen.getByRole('radio', { name: /Proofs\.tex/ });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Use this file' }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it('reports a no-match search and clears the filter whenever reopened', async () => {
    const { props, rerender } = setup();
    const search = screen.getByPlaceholderText('Search .tex files…');
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No files match "missing".')).toBeVisible();

    rerender(<SourceFilePickerDialog {...props} open={false} />);
    rerender(<SourceFilePickerDialog {...props} open />);
    await waitFor(() => expect(screen.getByPlaceholderText('Search .tex files…')).toHaveValue(''));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('shows content errors and custom styling while preserving the selected indicator', () => {
    const { props } = setup({
      selectedPath: 'blueprint/src/Main.tex',
      error: 'Could not attach this file.',
      errorClassName: 'picker-error',
      itemClassName: 'picker-item',
      footerClassName: 'picker-footer',
      selectedIndicator: <span>Currently selected</span>,
    });

    expect(screen.getByText('Could not attach this file.')).toHaveClass('picker-error');
    expect(screen.getByRole('radio', { name: /Main\.tex/ })).toHaveClass('picker-item', 'bg-muted');
    expect(screen.getByText('Currently selected')).toBeVisible();
    expect(document.querySelector('[data-slot="dialog-footer"]')).toHaveClass('picker-footer');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('locks actions and shows the configured progress label while saving', () => {
    const { props } = setup({
      selectedPath: 'blueprint/src/Main.tex',
      saving: true,
      loading: true,
    });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Attaching…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attaching…' }));
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
