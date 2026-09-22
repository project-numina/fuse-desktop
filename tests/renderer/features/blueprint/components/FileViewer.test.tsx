import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { beforeAll, vi } from 'vitest';

import FileViewer from '@/features/blueprint/components/FileViewer';
import { CodeEditor } from '@/components/editor/CodeEditor';

beforeAll(() => {
  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* iterator() {},
  }) as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

describe('Lean file navigation', () => {
  it('attaches a Markdown file or selected lines without Lean services', async () => {
    const onAttachFile = vi.fn();
    render(<FileViewer filePath="notes.md" content={'one\ntwo\nthree'} onAttachFile={onAttachFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onAttachFile).toHaveBeenLastCalledWith(undefined);
    const editor = EditorView.findFromDOM(document.querySelector('.cm-content') as HTMLElement)!;
    act(() => editor.dispatch({ selection: { anchor: 0, head: 6 } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Attach selection' }));
    expect(onAttachFile).toHaveBeenLastCalledWith({ start_line: 1, end_line: 2 });
    expect(editor.state.readOnly).toBe(true);
  });

  it('previews images without an executable iframe', () => {
    render(<FileViewer filePath="diagram.svg" fileUrl="/api/diagram.svg" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/diagram.svg');
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('clears an external CodeMirror ref when its editor unmounts', async () => {
    const viewRef = createRef<EditorView | null>();
    const { unmount } = render(
      <CodeEditor value={'one\ntwo'} language="lean" readonly viewRef={viewRef} />,
    );
    await waitFor(() => expect(viewRef.current).toBeInstanceOf(EditorView));
    unmount();
    expect(viewRef.current).toBeNull();
  });

  it('reports a requested position jump only after the active file editor mounts', async () => {
    const onJumped = vi.fn();
    render(
      <FileViewer
        filePath="Main.lean"
        content={'def one := 1\n\ndef target := 2'}
        jumpToLine={3}
        jumpToColumn={5}
        onJumped={onJumped}
      />,
    );
    await waitFor(() => expect(onJumped).toHaveBeenCalledTimes(1));
    const content = document.querySelector('.cm-content');
    const editor = EditorView.findFromDOM(content as HTMLElement);
    expect(editor?.state.selection.main.head).toBe(
      editor!.state.doc.line(3).from + 4,
    );
  });

  it('remounts CodeMirror when the file path changes', async () => {
    const { rerender } = render(
      <FileViewer filePath="Main.lean" content="def one := 1" />,
    );
    const firstContent = document.querySelector('.cm-content');
    await waitFor(() => expect(firstContent).not.toBeNull());
    const firstEditor = EditorView.findFromDOM(firstContent as HTMLElement);

    rerender(<FileViewer filePath="notes.tex" content="\\section{Notes}" />);

    const secondContent = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.cm-content');
      expect(element).not.toBeNull();
      expect(element).not.toBe(firstContent);
      return element!;
    });
    expect(EditorView.findFromDOM(secondContent)).not.toBe(firstEditor);
  });
});

describe('Lean file editing', () => {
  it('reports user edits when an editable host wires onChange', async () => {
    const onChange = vi.fn();
    render(
      <FileViewer
        filePath="Main.lean"
        content="def one := 1"
        readonly={false}
        onChange={onChange}
      />,
    );
    const content = document.querySelector('.cm-content');
    await waitFor(() => expect(content).not.toBeNull());
    const editor = EditorView.findFromDOM(content as HTMLElement);
    editor!.dispatch({ changes: { from: 12, insert: '2' } });
    expect(onChange).toHaveBeenCalledWith('def one := 12');
  });

  it('does not report edits while read-only', async () => {
    const onChange = vi.fn();
    render(
      <FileViewer
        filePath="Main.lean"
        content="def one := 1"
        readonly
        onChange={onChange}
      />,
    );
    const content = document.querySelector('.cm-content');
    await waitFor(() => expect(content).not.toBeNull());
    const editor = EditorView.findFromDOM(content as HTMLElement);
    expect(editor!.state.readOnly).toBe(true);
    editor!.dispatch({ changes: { from: 12, insert: '2' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates external content without remounting the editor', async () => {
    const { rerender } = render(
      <FileViewer filePath="Main.lean" content="def one := 1" />,
    );
    const content = document.querySelector('.cm-content');
    await waitFor(() => expect(content).not.toBeNull());
    const editor = EditorView.findFromDOM(content as HTMLElement);

    rerender(<FileViewer filePath="Main.lean" content="def one := 2" />);

    await waitFor(() => expect(editor?.state.doc.toString()).toBe('def one := 2'));
    expect(EditorView.findFromDOM(content as HTMLElement)).toBe(editor);
  });

  it('preserves the caret and reported position across a localized external update', async () => {
    const onChange = vi.fn();
    const onCursorChange = vi.fn();
    const original = 'def one := 1\ndef two := 2';
    const { rerender } = render(
      <FileViewer
        filePath="Main.lean"
        content={original}
        readonly={false}
        onChange={onChange}
        onCursorChange={onCursorChange}
      />,
    );
    const content = document.querySelector('.cm-content');
    await waitFor(() => expect(content).not.toBeNull());
    const editor = EditorView.findFromDOM(content as HTMLElement)!;
    const caret = editor.state.doc.line(2).from + 2;
    editor.dispatch({ selection: { anchor: caret } });
    onCursorChange.mockClear();

    rerender(
      <FileViewer
        filePath="Main.lean"
        content={`${original}\ndef three := 3`}
        readonly={false}
        onChange={onChange}
        onCursorChange={onCursorChange}
      />,
    );

    await waitFor(() => expect(editor.state.doc.lines).toBe(3));
    expect(editor.state.selection.main.head).toBe(caret);
    expect(onCursorChange).toHaveBeenLastCalledWith(2, 3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports the caret as 1-based line and column so the page can drive the Infoview', async () => {
    const onCursorChange = vi.fn();
    render(
      <FileViewer
        filePath="Main.lean"
        content={'def one := 1\ndef two := 2'}
        readonly={false}
        onCursorChange={onCursorChange}
      />,
    );
    const content = document.querySelector('.cm-content');
    await waitFor(() => expect(content).not.toBeNull());
    const editor = EditorView.findFromDOM(content as HTMLElement);
    // Moving the caret to the second line's third character reports (2, 3).
    editor!.dispatch({ selection: { anchor: 15 } });
    expect(onCursorChange).toHaveBeenLastCalledWith(2, 3);
  });
});
