import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConfirmDialog from '@/features/blueprint/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders configured copy and reports explicit actions', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open title="Delete source?" message="This cannot be undone."
        confirmLabel="Delete" cancelLabel="Keep" destructive
        onConfirm={onConfirm} onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This cannot be undone.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses defaults and omits an empty description', () => {
    render(<ConfirmDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Are you sure?');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('blocks both actions while busy', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open busy onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Working…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
