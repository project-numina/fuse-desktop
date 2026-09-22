import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));

import { guideTopics } from '@/components/guide/topics';
import Guide from '@/pages/guide/Guide';

describe('Guide overview', () => {
  it('links every topic card to its guide route with its summary', () => {
    render(<MemoryRouter><Guide /></MemoryRouter>);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', '');
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText(/connects a LaTeX blueprint, a coding agent, and Lean/)).toBeInTheDocument();

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(guideTopics.length);
    guideTopics.forEach((topic, index) => {
      const card = within(cards[index]);
      expect(card.getByRole('link', { name: new RegExp(topic.label) })).toHaveAttribute(
        'href',
        `/guide/${topic.slug}`,
      );
      expect(card.getByText(topic.description)).toBeInTheDocument();
    });
  });
});
