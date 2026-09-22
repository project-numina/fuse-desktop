import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const renderTiling = vi.hoisted(() => vi.fn());
vi.mock('@/state/theme', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/lib/einstein-tiling', () => ({
  generateTiling: () => [],
  renderTiling,
}));

import TilingPage from '@/components/layout/TilingPage';

describe('TilingPage', () => {
  it('paints the tiling and renders the card inside a router', () => {
    render(
      <MemoryRouter>
        <TilingPage>
          <p>Card content</p>
        </TilingPage>
      </MemoryRouter>,
    );
    expect(screen.getByText('Card content')).toBeInTheDocument();
    expect(renderTiling).toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // The small-screen warning renders as a sibling of <RouterProvider>, so the
  // page must not depend on a navigation context.
  it('renders outside the router', () => {
    expect(() =>
      render(
        <TilingPage cardWidth="xl">
          <p>Card content</p>
        </TilingPage>,
      ),
    ).not.toThrow();
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });
});
