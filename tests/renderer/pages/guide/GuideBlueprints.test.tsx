import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuideBlueprints', () => ({ default: () => <div>blueprints article</div> }));

import GuideBlueprintsPage from '@/pages/guide/GuideBlueprints';

describe('GuideBlueprintsPage', () => {
  it('renders the blueprints article in the active blueprints layout', () => {
    render(<GuideBlueprintsPage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'blueprints');
    expect(screen.getByText('blueprints article')).toBeInTheDocument();
  });
});
