import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageCopyButton from '@/features/chat/components/MessageCopyButton';

const writeText = vi.fn();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('MessageCopyButton', () => {
  it('copies the complete original message, including newlines and Markdown', async () => {
    const text = '# Heading\n\n' + 'A long message. '.repeat(1000);
    render(<MessageCopyButton text={text} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });
  it('reports clipboard failure and lets the user retry', async () => {
    writeText.mockRejectedValueOnce(new Error('Denied'));
    render(<MessageCopyButton text="Hello" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByText('Could not copy. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
