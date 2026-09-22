import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import LeanEmptyState from '@/features/blueprint/components/LeanEmptyState';

it('explains how to open a Lean file', () => {
  render(<LeanEmptyState />);
  expect(screen.getByRole('heading', { name: 'Open a file' })).toBeInTheDocument();
  expect(screen.getByText(/Browse your repository from the panel on the right/)).toBeInTheDocument();
});

it('matches the Graph empty-state vertical offset instead of using editor padding', () => {
  const { container } = render(<LeanEmptyState />);
  expect(container.firstElementChild).toHaveClass('pt-[clamp(3.5rem,34vh,40rem)]');
  expect(container.firstElementChild).not.toHaveClass('pt-24');
});
