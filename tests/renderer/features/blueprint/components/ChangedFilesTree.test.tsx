import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChangedFilesTree from '@/features/blueprint/components/ChangedFilesTree';
import type { DirectoryEntry } from '@/features/blueprint/components/changed-files-tree';

const entries: DirectoryEntry[] = [
  {
    kind: 'folder',
    name: 'Foo',
    path: 'lean/Foo',
    diff: { added: 2, deleted: 0 },
    buildErrors: { errors: 0, warnings: 1 },
  },
  {
    kind: 'file',
    name: 'Main.lean',
    path: 'lean/Main.lean',
    diff: null,
    buildErrors: { errors: 2, warnings: 0 },
  },
];

function tree(overrides: Partial<React.ComponentProps<typeof ChangedFilesTree>> = {}) {
  return (
    <ChangedFilesTree
      entries={entries}
      dividerIndex={1}
      loading={false}
      selectedFile="lean/Main.lean"
      breadcrumbs={[{ name: 'lean', path: 'lean' }]}
      onGoUp={vi.fn()}
      onGoHome={vi.fn()}
      onEnterFolder={vi.fn()}
      onActivate={vi.fn()}
      {...overrides}
    />
  );
}

describe('ChangedFilesTree', () => {
  it('renders metadata, selection, divider, and keyboard activation', () => {
    const onActivate = vi.fn();
    const { container } = render(tree({ onActivate }));

    expect(screen.getByTitle(/\+2 \/ -0 lines in this folder/)).toBeInTheDocument();
    expect(screen.getByTitle('1 warning in this folder')).toBeInTheDocument();
    expect(screen.getByTitle('2 errors in this file')).toBeInTheDocument();
    expect(container.querySelector('li[aria-hidden="true"]')).toBeInTheDocument();
    const fileRow = screen.getByText('Main.lean').closest('[role="button"]') as HTMLElement;
    expect(fileRow).toHaveClass('font-semibold');
    fireEvent.keyDown(fileRow, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(entries[1]);
  });

  it('distinguishes loading, nested empty folders, and an empty root', () => {
    const view = render(tree({ entries: [], loading: true, breadcrumbs: [] }));
    expect(screen.getByText('Loading folder…')).toBeInTheDocument();
    view.rerender(tree({ entries: [], loading: false }));
    expect(screen.getByText('Empty folder')).toBeInTheDocument();
    view.rerender(tree({ entries: [], loading: false, breadcrumbs: [] }));
    expect(screen.getByText('No files')).toBeInTheDocument();
  });
});
