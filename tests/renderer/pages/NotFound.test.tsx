import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/TilingPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import NotFound from '@/pages/NotFound';

describe('NotFound', () => {
  it('renders an accessible 404 and navigates home', () => {
    render(
      <MemoryRouter initialEntries={['/missing-page']}>
        <Routes>
          <Route path="*" element={<NotFound />} />
          <Route path="/" element={<h2>Dashboard</h2>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('img', { name: 'Numina' })).toHaveAttribute(
      'src',
      '/numina_logo.svg',
    );
    expect(screen.getByRole('heading', { name: 'Fuse' })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();

    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('href', '/');
    fireEvent.click(home);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
