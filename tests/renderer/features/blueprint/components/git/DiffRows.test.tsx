import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StructuredLine } from '@/features/blueprint/lib/structured-diff';
import DiffRows from '@/features/blueprint/components/git/DiffRows';

const lines: StructuredLine[] = [
  { kind: 'hunk', text: '@@ -1,2 +1,2 @@', oldNum: null, newNum: null },
  { kind: 'remove', text: 'old', oldNum: 1, newNum: null },
  { kind: 'add', text: 'new', oldNum: null, newNum: 1 },
  { kind: 'context', text: 'same', oldNum: 2, newNum: 2 },
  { kind: 'no-newline', text: '\\ No newline', oldNum: null, newNum: null },
];

describe('DiffRows', () => {
  it('renders hunk, content, and no-newline rows', () => {
    render(<DiffRows lines={lines} />);
    for (const text of ['@@ -1,2 +1,2 @@', 'old', 'new', 'same', '\\ No newline']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('shows the correct gutters and +/- markers for changes', () => {
    const { container } = render(<DiffRows lines={lines} />);
    const add = screen.getByText('new').parentElement;
    const remove = screen.getByText('old').parentElement;
    expect(add).toHaveTextContent('1+new');
    expect(remove).toHaveTextContent('1-old');
    expect(container).toHaveTextContent('22same');
  });
});
