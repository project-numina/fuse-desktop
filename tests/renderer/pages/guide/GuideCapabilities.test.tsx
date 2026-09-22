import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuideCapabilities', () => ({ default: () => <div>capabilities article</div> }));

import GuideCapabilitiesPage from '@/pages/guide/GuideCapabilities';

describe('GuideCapabilitiesPage', () => {
  it('renders the capabilities article in the active capabilities layout', () => {
    render(<GuideCapabilitiesPage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'capabilities');
    expect(screen.getByText('capabilities article')).toBeInTheDocument();
  });
});
