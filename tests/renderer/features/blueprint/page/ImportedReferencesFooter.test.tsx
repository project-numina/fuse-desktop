import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ImportedReferencesFooter from '@/features/blueprint/page/ImportedReferencesFooter';

describe('ImportedReferencesFooter', () => {
  it('omits the footer when there is no status or source to show', () => {
    const { container } = render(
      <ImportedReferencesFooter
        filesError={null}
        sources={[]}
        loading={false}
        loadFailed={false}
        showingReference={false}
        selectedSourceId=""
        onOpenSource={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders source status and delegates source selection', () => {
    const onOpenSource = vi.fn();
    render(
      <ImportedReferencesFooter
        filesError="offline"
        sources={[{
          id: 'notes',
          display_name: 'Research notes',
          source_type: 'text',
          artifacts: [],
          metadata: {},
        }]}
        loading
        loadFailed
        showingReference
        selectedSourceId="notes"
        onOpenSource={onOpenSource}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Could not load this folder');
    expect(screen.getByText('Loading references…')).toBeVisible();
    expect(screen.getByText('Could not load imported references.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Research notes' }));
    expect(onOpenSource).toHaveBeenCalledWith('notes');
  });
});
