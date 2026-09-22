import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChangedFilesPanel from '@/features/blueprint/components/ChangedFilesPanel';

function renderPanel() {
  const onSelectFile = vi.fn();
  render(
    <ChangedFilesPanel
      files={[
        'apps/example/Example.lean',
        'lean/conjectures/Conjectures.lean',
        'lean/kakeya/Kakeya.lean',
        'lean/kakeya/Kakeya/Basic.lean',
      ]}
      rootPath="lean/kakeya"
      onSelectFile={onSelectFile}
      onToggleCollapsed={vi.fn()}
    />,
  );
  return onSelectFile;
}

describe('ChangedFilesPanel', () => {
  it('treats the selected Lean project as the visible tree root', () => {
    renderPanel();

    expect(screen.getByText('Kakeya')).toBeInTheDocument();
    expect(screen.getByText('Kakeya.lean')).toBeInTheDocument();
    expect(screen.queryByText('apps')).not.toBeInTheDocument();
    expect(screen.queryByText('lean')).not.toBeInTheDocument();
    expect(screen.queryByText('conjectures')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go up one folder' }))
      .not.toBeInTheDocument();
  });

  it('keeps selected file paths repository-relative', () => {
    const onSelectFile = renderPanel();

    fireEvent.click(screen.getAllByText('Kakeya')[0]);
    fireEvent.click(screen.getByText('Basic.lean'));

    expect(onSelectFile).toHaveBeenCalledWith(
      'lean/kakeya/Kakeya/Basic.lean',
    );
  });

  it('keeps the current folder when selection clears', () => {
    const commonProps = {
      files: [
        'lean/kakeya/Kakeya.lean',
        'lean/kakeya/Kakeya/Basic.lean',
      ],
      rootPath: 'lean/kakeya',
      onSelectFile: vi.fn(),
      onToggleCollapsed: vi.fn(),
    };
    const { rerender } = render(
      <ChangedFilesPanel {...commonProps} selectedFile={null} />,
    );

    fireEvent.click(screen.getAllByText('Kakeya')[0]);
    expect(screen.getByText('Basic.lean')).toBeInTheDocument();

    rerender(
      <ChangedFilesPanel
        {...commonProps}
        selectedFile="lean/kakeya/Kakeya/Basic.lean"
      />,
    );
    rerender(<ChangedFilesPanel {...commonProps} selectedFile={null} />);

    expect(screen.getByText('Basic.lean')).toBeInTheDocument();
  });
});
