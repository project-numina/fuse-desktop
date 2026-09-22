import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RepositoryFileEntry, RepositorySource } from '@/lib/api';

vi.mock('@/features/chat/components/AttachmentPicker', () => ({
  default: ({ open, onSelectSource, onRequestAddSource }: {
    open: boolean;
    onSelectSource: (source: RepositorySource) => void;
    onRequestAddSource: () => void;
  }) => open ? (
    <div>
      <button type="button" onClick={() => onSelectSource({
        id: 'source-1', display_name: 'paper.tex', source_type: 'latex', artifacts: ['latex'],
      } as RepositorySource)}>Choose paper</button>
      <button type="button" onClick={onRequestAddSource}>Add new source</button>
    </div>
  ) : null,
}));

vi.mock('@/features/blueprint/components/AddSourceDialog', () => ({
  default: ({ open, onUploaded, onSelectRepoFile }: {
    open: boolean;
    onUploaded: (source: RepositorySource) => void;
    onSelectRepoFile: (file: RepositoryFileEntry) => void;
  }) => open ? (
    <div>
      <button type="button" onClick={() => onUploaded({
        id: 'source-2', display_name: 'uploaded.pdf', source_type: 'pdf', artifacts: ['original'],
      } as RepositorySource)}>Finish upload</button>
      <button type="button" onClick={() => onSelectRepoFile({
        path: 'src/Basic.lean', name: 'Basic.lean', size: 42,
      })}>Choose repo file</button>
    </div>
  ) : null,
}));

import { ChatComposer, type ChatComposerHandle } from '@/features/chat/components/composer/ChatComposer';

function setup(overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const props = {
    value: '', onChange: vi.fn(), placeholder: 'Try proving the theorem',
    canSend: true, hasContent: false, sessionBusy: false,
    onSend: vi.fn(), onStop: vi.fn(),
    onAddAttachment: vi.fn(), onRemoveAttachment: vi.fn(), onSourceUploaded: vi.fn(), ...overrides,
  };
  return { ...render(<ChatComposer {...props} />), props };
}

describe('ChatComposer', () => {
  it('renders a tab-completable ghost only for empty input', () => {
    const { rerender, props } = setup();
    expect(screen.getByText('Try proving the theorem')).toBeInTheDocument();
    expect(screen.getByText('Tab')).toBeInTheDocument();
    rerender(<ChatComposer {...props} value="started" />);
    expect(screen.queryByText('Tab')).not.toBeInTheDocument();
  });

  it('keeps its height when the ghost placeholder becomes typed text', () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this instanceof HTMLPreElement ? 28 : 24;
      });

    try {
      const { rerender, props } = setup({ placeholderCompletable: false });
      const textarea = screen.getByRole('textbox');
      expect(textarea.style.height).toBe('28px');

      rerender(<ChatComposer {...props} value="a" />);
      expect(textarea.style.height).toBe('28px');
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it('does not pin typed text to a multiline ghost height', () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this instanceof HTMLPreElement ? 64 : 24;
      });

    try {
      const { rerender, props } = setup({ placeholderCompletable: false });
      const textarea = screen.getByRole('textbox');
      expect(textarea.style.height).toBe('64px');

      rerender(<ChatComposer {...props} value="a" />);
      expect(textarea.style.height).toBe('24px');
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it('reports typing and completes suggestions with Tab', () => {
    const { props } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(props.onChange).toHaveBeenCalledWith('hello');
    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(props.onChange).toHaveBeenLastCalledWith(props.placeholder);
  });

  it('sends on Enter but preserves shifted newlines', () => {
    const { props } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('offers stop while busy with nothing composed', () => {
    const { rerender, props } = setup({ canSend: false });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    rerender(<ChatComposer {...props} sessionBusy />);
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    // Named for what it does: this ends the session rather than just the
    // current response, unlike the same-shaped control in other chat apps.
    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it('morphs Stop into Send when composing during a running turn', () => {
    const { rerender, props } = setup({
      sessionBusy: true,
      canSend: false,
    });
    expect(screen.getByRole('button', { name: 'End this session' }))
      .toBeInTheDocument();

    rerender(<ChatComposer {...props} hasContent canSend />);
    expect(screen.queryByRole('button', { name: 'End this session' }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(props.onSend).toHaveBeenCalledOnce();
  });

  it('keeps the morphed Send disabled while Stop is pending', () => {
    const { props } = setup({
      sessionBusy: true,
      stopPending: true,
      canSend: false,
      hasContent: true,
    });

    expect(screen.queryByRole('button', { name: 'End this session' }))
      .not.toBeInTheDocument();
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton).toBeDisabled();
    fireEvent.click(sendButton);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it('latches stop while a cancel is already in flight', () => {
    const { props } = setup({ sessionBusy: true, stopPending: true });
    const stopButton = screen.getByRole('button', { name: 'End this session' });
    expect(stopButton).toBeDisabled();
    fireEvent.click(stopButton);
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it('does not offer Tab on a hint the user should not send', () => {
    // While the agent works the ghost is a hint about what the box is for,
    // not a draft: completing it would post the hint itself (ADR 044).
    const { props } = setup({ sessionBusy: true, placeholderCompletable: false });
    expect(screen.getByText('Try proving the theorem')).toBeInTheDocument();
    expect(screen.queryByText('Tab')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('does not submit from the keyboard when sending is disabled', () => {
    const { props } = setup({ canSend: false });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it('selects existing and newly uploaded sources', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Attach source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose paper' }));
    expect(props.onAddAttachment).toHaveBeenCalledWith(expect.objectContaining({
      source_id: 'source-1', display_name: 'paper.tex', selection: { kind: 'entire_file' },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Attach source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add new source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish upload' }));
    expect(props.onAddAttachment).toHaveBeenLastCalledWith(expect.objectContaining({
      source_id: 'source-2', display_name: 'uploaded.pdf',
    }));
    expect(props.onSourceUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'source-2' }));
  });

  it('attaches a repository file as a repo_file attachment', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Attach source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add new source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose repo file' }));
    expect(props.onAddAttachment).toHaveBeenCalledWith({
      attachment_kind: 'repo_file',
      source_id: null,
      artifact_kind: null,
      repo_path: 'src/Basic.lean',
      display_name: 'src/Basic.lean',
      selection: { kind: 'entire_file' },
    });
  });

  it('renders and removes draft attachment chips', () => {
    const attachment = {
      attachment_kind: 'backend_source' as const,
      source_id: 'source-1', display_name: 'paper.tex',
      selection: { kind: 'line_range', start_line: 4, end_line: 7 },
    };
    const { props } = setup({ attachments: [attachment] });
    expect(screen.getByText('lines 4-7', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove paper.tex' }));
    expect(props.onRemoveAttachment).toHaveBeenCalledWith(attachment);
  });

  it('exposes deferred focus through its handle', () => {
    const callback = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(0); return 1; });
    const ref = createRef<ChatComposerHandle>();
    setup({ ref } as never);
    ref.current?.focus();
    expect(screen.getByRole('textbox')).toHaveFocus();
    callback.mockRestore();
  });
});
