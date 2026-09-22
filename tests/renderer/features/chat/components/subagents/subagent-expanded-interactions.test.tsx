import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  useDialogFocusTrap,
  useExpandedTimelineScroll,
} from '@/features/chat/components/subagents/subagent-expanded-interactions';

function DialogHarness({ onClose }: { onClose: () => void }) {
  const dialog = useDialogFocusTrap(onClose);
  return (
    <div ref={dialog.containerRef} tabIndex={-1} onKeyDown={dialog.onKeyDown}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

function ScrollHarness({ onChange }: {
  onChange: (position: { scrollTop: number; following: boolean }) => void;
}) {
  const renderCount = useRef(0);
  renderCount.current += 1;
  const scroll = useExpandedTimelineScroll({
    active: false,
    hasTimeline: true,
    selectedIteration: 'run-1',
    onScrollPositionChange: onChange,
    childActivityVersion: '',
    runActivityVersion: String(renderCount.current),
  });
  return <div ref={scroll.timelineRef} onScroll={scroll.handleTimelineScroll} />;
}

describe('subagent expanded interactions', () => {
  it('focuses the modal, traps Tab, and closes on Escape', () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    const dialog = first.parentElement as HTMLElement;

    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports the initial top position for a finished timeline', () => {
    const onChange = vi.fn();
    render(<ScrollHarness onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ scrollTop: 0, following: false });
  });
});
