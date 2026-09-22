import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InfoviewPanel from '@/features/blueprint/components/InfoviewPanel';

describe('InfoviewPanel', () => {
  it('gives errors precedence and offers Lean setup when available', () => {
    const onSetupLean = vi.fn();
    render(
      <InfoviewPanel
        error="Lean is not configured for this workspace."
        loading
        goals={['ignored goal']}
        onSetupLean={onSetupLean}
      />,
    );

    expect(screen.getByText('Lean is not configured for this workspace.')).toBeVisible();
    expect(screen.queryByText('ignored goal')).not.toBeInTheDocument();
    expect(screen.queryByText('Querying Lean server…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up Lean' }));
    expect(onSetupLean).toHaveBeenCalledOnce();
  });

  it('renders the cold-query loading state only when no useful data exists', () => {
    const { rerender } = render(<InfoviewPanel loading />);

    expect(screen.getByText('Querying Lean server…')).toBeVisible();
    expect(screen.getByText(/30–60 seconds/)).toBeVisible();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(3);

    rerender(<InfoviewPanel loading goals={['x : Nat\n⊢ x = x']} />);
    expect(screen.queryByText('Querying Lean server…')).not.toBeInTheDocument();
    expect(screen.getByText((_, element) => (
      element?.tagName === 'PRE' && element.textContent === 'x : Nat\n⊢ x = x'
    ))).toBeVisible();

    rerender(<InfoviewPanel loading lineContext="theorem active" />);
    expect(screen.queryByText('Querying Lean server…')).not.toBeInTheDocument();
    expect(screen.queryByText(/No goals at cursor/)).not.toBeInTheDocument();
  });

  it('renders direct goals with plural labeling and an empty cursor hint', () => {
    const { rerender } = render(
      <InfoviewPanel goals={['⊢ True', '⊢ 1 = 1']} />,
    );

    expect(screen.getByRole('heading', { name: 'Goals2' })).toBeVisible();
    expect(screen.getByText('⊢ True')).toBeVisible();
    expect(screen.getByText('⊢ 1 = 1')).toBeVisible();

    rerender(<InfoviewPanel />);
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeVisible();
    expect(screen.getByText(/No goals at cursor/)).toBeVisible();
  });

  it('renders before/after goals ahead of the expected-type fallback', () => {
    const { rerender } = render(
      <InfoviewPanel
        goalsBefore={['case before']}
        goalsAfter={['case after']}
        expectedType="ExpectedType"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Before' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'After' })).toBeVisible();
    expect(screen.queryByText('ExpectedType')).not.toBeInTheDocument();

    rerender(<InfoviewPanel goalsBefore={['before only']} />);
    expect(screen.getByText('before only')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'After' })).not.toBeInTheDocument();

    rerender(<InfoviewPanel goalsAfter={['after only']} />);
    const afterHeading = screen.getByRole('heading', { name: 'After' });
    expect(afterHeading).toBeVisible();
    expect(afterHeading.parentElement).not.toHaveClass('mt-[var(--space-3)]');

    rerender(<InfoviewPanel expectedType="Nat → Nat" />);
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeVisible();
    expect(screen.getByText('Nat → Nat')).toBeVisible();
  });

  it('renders incomplete diagnostics with severity markers and jump locations', () => {
    const onJump = vi.fn();
    render(
      <InfoviewPanel
        diagnosticsIncomplete
        diagnostics={[
          { severity: 'error', message: 'type mismatch', line: 12, column: 7 },
          { severity: 'warning', message: 'declaration uses sorry', line: 18, column: 3 },
          { severity: 'information', message: 'try this tactic', line: 22, column: 1 },
        ]}
        onJump={onJump}
      />,
    );

    expect(screen.getByText(/messages may be incomplete/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Messages3' })).toBeVisible();
    expect(screen.getByText('type mismatch')).toBeVisible();
    expect(screen.getByText('declaration uses sorry')).toBeVisible();
    expect(screen.getByText('try this tactic')).toBeVisible();

    const errorJump = screen.getByRole('button', { name: '12:7' });
    const warningJump = screen.getByRole('button', { name: '18:3' });
    const infoJump = screen.getByRole('button', { name: '22:1' });
    expect(errorJump.firstElementChild).toHaveStyle({ background: 'var(--build-error)' });
    expect(warningJump.firstElementChild).toHaveStyle({ background: 'var(--build-warning)' });
    expect(infoJump.firstElementChild).toHaveStyle({ background: 'var(--numina-info)' });

    fireEvent.click(warningJump);
    expect(onJump).toHaveBeenCalledWith({ line: 18, column: 3 });
  });

  it('omits optional setup and jump callbacks safely', () => {
    const { rerender } = render(<InfoviewPanel error="Lean failed" />);
    expect(screen.queryByRole('button', { name: 'Set up Lean' })).not.toBeInTheDocument();

    rerender(
      <InfoviewPanel
        diagnostics={[{ severity: 'error', message: 'failure', line: 1, column: 2 }]}
      />,
    );
    expect(() => fireEvent.click(screen.getByRole('button', { name: '1:2' }))).not.toThrow();
  });
});
