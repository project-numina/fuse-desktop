import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/TilingPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="tiling-page">{children}</main>
  ),
}));

import SmallScreenWarning from '@/components/layout/SmallScreenWarning';

describe('SmallScreenWarning', () => {
  it('explains how to recover without requiring router context', () => {
    render(<SmallScreenWarning />);

    expect(screen.getByTestId('tiling-page')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Numina' })).toHaveAttribute(
      'src',
      '/numina_logo.svg',
    );
    expect(screen.getByRole('heading', { name: 'Fuse' })).toBeInTheDocument();
    expect(screen.getByText('Window too small')).toBeInTheDocument();
    expect(
      screen.getByText('Fuse needs a larger window. Resize or maximize it to continue.'),
    ).toBeInTheDocument();
  });
});
