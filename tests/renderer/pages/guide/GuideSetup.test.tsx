import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuideSetup', () => ({ default: () => <div>setup article</div> }));

import GuideSetupPage from '@/pages/guide/GuideSetup';

describe('GuideSetupPage', () => {
  it('renders the setup article in the active setup layout', () => {
    render(<GuideSetupPage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'setup');
    expect(screen.getByText('setup article')).toBeInTheDocument();
  });
});
