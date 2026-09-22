import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChapterRail from '@/features/blueprint/components/ChapterRail';

const chapters = [
  { path: 'blueprint/src/content.tex', label: 'content.tex', isEntrypoint: true },
  { path: 'blueprint/src/chapter/intro.tex', label: 'chapter/intro.tex', isEntrypoint: false },
  { path: 'blueprint/src/chapter/main.tex', label: 'chapter/main.tex', isEntrypoint: false },
];

describe('ChapterRail', () => {
  it('hides navigation when there is only one chapter', () => {
    render(<ChapterRail chapters={[chapters[0]]} activePath={chapters[0].path} onSelect={vi.fn()} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders each chapter and identifies the entrypoint', () => {
    render(<ChapterRail chapters={chapters} activePath={chapters[0].path} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByTitle(chapters[0].path)).toHaveTextContent('#content.tex');
    expect(screen.getByTitle(chapters[1].path)).toHaveTextContent('chapter/intro.tex');
  });

  it('marks the active path and reports a selection', () => {
    const onSelect = vi.fn();
    render(<ChapterRail chapters={chapters} activePath={chapters[1].path} onSelect={onSelect} />);
    expect(screen.getByTitle(chapters[1].path)).toHaveClass('border-foreground');
    expect(screen.getByTitle(chapters[0].path)).not.toHaveClass('border-foreground');
    fireEvent.click(screen.getByTitle(chapters[2].path));
    expect(onSelect).toHaveBeenCalledWith(chapters[2].path);
  });

  it('disables every chapter while a transition is pending', () => {
    render(<ChapterRail chapters={chapters} activePath={chapters[0].path} disabled onSelect={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});
