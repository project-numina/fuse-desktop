import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuidePullRequests', () => ({ default: () => <div>changes article</div> }));

import GuidePullRequestsPage from '@/pages/guide/GuidePullRequests';

describe('GuidePullRequestsPage', () => {
  it('renders the changes article at the legacy pull-request route', () => {
    render(<GuidePullRequestsPage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'pull-requests');
    expect(screen.getByText('changes article')).toBeInTheDocument();
  });
});
