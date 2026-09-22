import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SectionSelector from '@/features/blueprint/components/SectionSelector';

const chapters = [
  { path: 'blueprint/src/content.tex', label: 'content.tex', isEntrypoint: true },
  {
    path: 'blueprint/src/chapter/intro.tex',
    label: 'chapter/intro.tex',
    title: 'Introduction',
    isEntrypoint: false,
  },
  { path: 'blueprint/src/chapter/main.tex', label: 'chapter/main.tex', isEntrypoint: false },
];

function setup(activePath = chapters[1].path) {
  const onSelect = vi.fn();
  render(<SectionSelector chapters={chapters} activePath={activePath} onSelect={onSelect} />);
  return onSelect;
}

describe('SectionSelector', () => {
  it('starts collapsed with the active chapter display label', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Choose section' })).toHaveTextContent('Introduction');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists entrypoint, titled, and filename-derived section labels', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Choose section' }));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Index');
    expect(items[0]).toHaveTextContent('content.tex');
    expect(items[1]).toHaveTextContent('1.Introduction');
    expect(items[1]).toHaveTextContent('chapter/intro.tex');
    expect(items[2]).toHaveTextContent('2.main');
  });

  it('selects a different section and closes the menu', () => {
    const onSelect = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Choose section' }));
    fireEvent.click(screen.getAllByRole('menuitem')[2]);
    expect(onSelect).toHaveBeenCalledWith(chapters[2].path);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes without reporting a selection for the active item', () => {
    const onSelect = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Choose section' }));
    fireEvent.click(screen.getAllByRole('menuitem')[1]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
