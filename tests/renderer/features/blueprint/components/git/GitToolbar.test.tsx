import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GitToolbar, { type GitToolbarProps } from '@/features/blueprint/components/git/GitToolbar';

function props(overrides: Partial<GitToolbarProps> = {}): GitToolbarProps {
  return { activeTab: 'changes', onTabChange: vi.fn(), changesCount: 0, branchName: 'feature/proof', ...overrides };
}

describe('GitToolbar', () => {
  it('shows a changes badge only for a nonzero count', () => {
    const { rerender } = render(<GitToolbar {...props()} />);
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    rerender(<GitToolbar {...props({ changesCount: 4 })} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('exposes active tab semantics and reports tab changes', () => {
    const options = props({ activeTab: 'history' });
    render(<GitToolbar {...options} />);
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(options.onTabChange).toHaveBeenCalledWith('changes');
  });

  it('shows the branch without commit, push, or sync actions', () => {
    render(<GitToolbar {...props()} />);
    expect(screen.getByText('feature/proof')).toHaveAttribute('title', 'feature/proof');
    expect(screen.queryByRole('button', { name: /commit|push|sync/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});
