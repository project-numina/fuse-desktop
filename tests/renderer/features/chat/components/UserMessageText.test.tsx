import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserMessageText from '@/features/chat/components/UserMessageText';

let height = 300;
const observers: Array<{ measure: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];
beforeEach(() => {
  height = 300;
  observers.length = 0;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  const style = document.createElement('div').style;
  style.lineHeight = '20px';
  style.fontSize = '14px';
  vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let end = 0;
    return { setStart: () => {}, setEnd: (_node: Node, offset: number) => { end = offset; }, getBoundingClientRect: () => ({ bottom: end <= 3 ? 100 : 300 }) } as unknown as Range;
  });
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    constructor(public measure: () => void) { observers.push(this); }
    observe() {}
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('UserMessageText', () => {
  it('leaves short messages alone', () => {
    height = 40;
    render(<UserMessageText text="Hello" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    const copy = screen.getByRole('button', { name: 'Copy message' });
    const bubble = screen.getByText('Hello').closest('.user-bubble')!;
    expect(bubble.contains(copy)).toBe(false);
    expect(bubble.nextElementSibling).toHaveClass('user-message-actions');
    expect(bubble.parentElement).toHaveClass('user-message');
    // Remains in the keyboard tab order even when hover actions are transparent.
    expect(copy).not.toHaveAttribute('tabindex', '-1');
  });

  it('collapses beyond ten rendered lines without modifying the original content', () => {
    const text = 'A long prompt\nwith **literal Markdown**, code, and the original ending.';
    render(<UserMessageText text={text} />);
    const more = screen.getByRole('button', { name: 'Show more' });
    const content = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(content.textContent).toBe(text);
    expect(content).toHaveClass('is-truncated');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(`${Array.from(text.slice(3)).length} characters hidden`)).toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    expect(content).toHaveClass('is-expanded');
    expect(content).not.toHaveClass('is-truncated');
    expect(screen.queryByText(/characters hidden/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(content).not.toHaveClass('is-expanded');
    expect(content.textContent).toBe(text);
  });

  it('remeasures wrapping when the chat panel changes width', () => {
    height = 200;
    render(<UserMessageText text="Wrap this message" />);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    act(() => { height = 220; observers[0].measure(); });
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    act(() => { height = 200; observers[0].measure(); });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('keeps expansion independent for each message and resets it for replacement text', () => {
    const view = render(<><UserMessageText text="First" /><UserMessageText text="Second" /></>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show more' })[0]);
    expect(screen.getAllByRole('button', { name: 'Show less' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Show more' })).toHaveLength(1);
    view.rerender(<><UserMessageText text="Different chat" /><UserMessageText text="Second" /></>);
    expect(screen.getAllByRole('button', { name: 'Show more' })).toHaveLength(2);
    view.unmount();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });
});
