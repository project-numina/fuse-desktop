import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Textarea } from '@/components/ui/textarea';

describe('Textarea', () => {
  it('forwards native attributes and reports user input', () => {
    const onChange = vi.fn();
    render(
      <Textarea
        aria-label="Notes"
        name="notes"
        placeholder="Add a note"
        onChange={onChange}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea).toHaveAttribute('data-slot', 'textarea');
    expect(textarea).toHaveAttribute('name', 'notes');
    expect(textarea).toHaveAttribute('placeholder', 'Add a note');

    fireEvent.change(textarea, { target: { value: 'A useful note' } });
    expect(textarea).toHaveValue('A useful note');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('preserves state attributes and merges caller classes', () => {
    render(
      <Textarea
        aria-label="Explanation"
        aria-invalid="true"
        disabled
        className="min-h-32 custom-textarea"
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Explanation' });
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveClass('min-h-32', 'custom-textarea');
  });
});
