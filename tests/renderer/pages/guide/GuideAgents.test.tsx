import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuideAgents', () => ({ default: () => <div>agents article</div> }));

import GuideAgentsPage from '@/pages/guide/GuideAgents';

describe('GuideAgentsPage', () => {
  it('renders the agents article in the active agents layout', () => {
    render(<GuideAgentsPage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'agents');
    expect(screen.getByText('agents article')).toBeInTheDocument();
  });
});
