import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/AppHeader', () => ({
  default: ({ breadcrumbs }: { breadcrumbs?: React.ReactNode }) => (
    <header data-testid="app-header">{breadcrumbs}</header>
  ),
}));
vi.mock('@/components/layout/AppFooter', () => ({
  default: () => <footer data-testid="app-footer" />,
}));

import AppPage from '@/components/layout/AppPage';

describe('AppPage', () => {
  it('composes the standard shell and selected content width', () => {
    render(
      <AppPage
        width="xl"
        breadcrumbs={<span>Repository</span>}
        mainClassName="custom-main"
      >
        <p>Page content</p>
      </AppPage>,
    );

    expect(screen.getByTestId('app-header')).toHaveTextContent('Repository');
    expect(screen.getByText('Page content').closest('main')).toHaveClass(
      'max-w-6xl',
      'custom-main',
    );
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
  });
});
