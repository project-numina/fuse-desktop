import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuideTroubleshooting', () => ({ default: () => <div>troubleshooting article</div> }));

import GuideTroubleshootingPage from '@/pages/guide/GuideTroubleshooting';

describe('GuideTroubleshootingPage', () => {
  it('renders the troubleshooting article in the active troubleshooting layout', () => {
    render(<GuideTroubleshootingPage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'troubleshooting');
    expect(screen.getByText('troubleshooting article')).toBeInTheDocument();
  });
});
