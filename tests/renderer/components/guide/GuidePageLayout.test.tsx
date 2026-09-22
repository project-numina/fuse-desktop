import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/AppHeader', () => ({
  default: ({ breadcrumbs }: { breadcrumbs?: React.ReactNode }) => (
    <header data-testid="app-header">{breadcrumbs}</header>
  ),
}));

vi.mock('@/components/layout/AppFooter', () => ({
  default: () => <footer>application footer</footer>,
}));

import GuidePageLayout from '@/components/guide/GuidePageLayout';
import { guideTopics } from '@/components/guide/topics';

function show(slug?: string) {
  return render(
    <MemoryRouter>
      <GuidePageLayout slug={slug}>
        <h1>Topic content</h1>
      </GuidePageLayout>
    </MemoryRouter>,
  );
}

describe('GuidePageLayout', () => {
  it('renders the guide shell and ordered topic navigation', () => {
    show('workspace');

    const header = screen.getByTestId('app-header');
    expect(within(header).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/guide');
    expect(screen.getByRole('heading', { name: 'Topic content' })).toBeInTheDocument();
    expect(screen.getByText('application footer')).toBeInTheDocument();

    const links = within(screen.getByRole('navigation', { name: 'Guide topics' })).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      ...guideTopics.map((topic) => topic.label),
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/guide',
      ...guideTopics.map((topic) => `/guide/${topic.slug}`),
    ]);
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('uses the overview as the default active topic', () => {
    show();

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    for (const topic of guideTopics) {
      expect(screen.getByRole('link', { name: topic.label })).not.toHaveAttribute('aria-current');
    }
  });
});
