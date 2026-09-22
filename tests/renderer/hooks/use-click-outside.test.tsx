import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useClickOutside } from '@/hooks/use-click-outside';

function Harness({ dismiss, enabled = true }: { dismiss: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, dismiss, { enabled });
  return <div><div ref={ref} data-testid="inside" /><button data-testid="outside" /></div>;
}

describe('useClickOutside', () => {
  it('dismisses for outside clicks and Escape but not inside interactions', () => {
    const dismiss = vi.fn();
    const view = render(<Harness dismiss={dismiss} />);
    fireEvent.mouseDown(view.getByTestId('inside'));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.mouseDown(view.getByTestId('outside'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('does not attach listeners while disabled', () => {
    const dismiss = vi.fn();
    const view = render(<Harness dismiss={dismiss} enabled={false} />);
    fireEvent.mouseDown(view.getByTestId('outside'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismiss).not.toHaveBeenCalled();
  });
});
