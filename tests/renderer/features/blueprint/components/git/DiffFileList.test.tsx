import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DiffFileList from '@/features/blueprint/components/git/DiffFileList';

const files = [
  { path: 'a/Foo.lean', additions: 3, deletions: 0 },
  { path: 'b/Bar.lean', additions: 1, deletions: 2 },
];

describe('DiffFileList', () => {
  it('renders paths and only nonzero change counts', () => {
    render(<DiffFileList files={files} selectedPath={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('a/Foo.lean')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
  });

  it('marks and reports the selected file', () => {
    const onSelect = vi.fn();
    render(<DiffFileList files={files} selectedPath="b/Bar.lean" onSelect={onSelect} />);
    expect(screen.getByText('b/Bar.lean').closest('li')).toHaveClass(
      '[&>button]:bg-[var(--accent-overlay-soft)]',
    );
    fireEvent.click(screen.getByRole('button', { name: /b\/Bar\.lean/ }));
    expect(onSelect).toHaveBeenCalledWith('b/Bar.lean');
  });
});
