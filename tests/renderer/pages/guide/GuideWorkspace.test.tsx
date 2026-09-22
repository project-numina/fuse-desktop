import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/guide/GuidePageLayout', () => ({
  default: ({ slug, children }: { slug?: string; children?: ReactNode }) => (
    <main data-testid="guide-layout" data-slug={slug}>{children}</main>
  ),
}));
vi.mock('@/components/guide/GuideWorkspace', () => ({ default: () => <div>workspace article</div> }));

import GuideWorkspacePage from '@/pages/guide/GuideWorkspace';

describe('GuideWorkspacePage', () => {
  it('renders the workspace article in the active workspace layout', () => {
    render(<GuideWorkspacePage />);

    expect(screen.getByTestId('guide-layout')).toHaveAttribute('data-slug', 'workspace');
    expect(screen.getByText('workspace article')).toBeInTheDocument();
  });
});
