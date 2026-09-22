import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRepositorySource } from '@/lib/api';

import SourceUploadModal, { type SourceUploadModalProps } from '@/features/blueprint/components/SourceUploadModal';

vi.mock('@/lib/api', () => ({ uploadRepositorySource: vi.fn() }));
// Counts renders of the dialog subtree: the mocked editor re-renders exactly
// when its parent does.
const editorRenders = vi.hoisted(() => ({ count: 0 }));
const dialogLifecycle = vi.hoisted(() => ({
  onOpenChangeComplete: undefined as ((open: boolean) => void) | undefined,
}));

// Capture close completion while preserving the real dialog. Base UI normally
// derives completion from CSS animations, which jsdom does not run.
vi.mock('@/components/ui/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/dialog')>();
  return {
    ...actual,
    Dialog: ({ onOpenChangeComplete, ...props }: ComponentProps<typeof actual.Dialog>) => {
      dialogLifecycle.onOpenChangeComplete = onOpenChangeComplete;
      const ActualDialog = actual.Dialog;
      return <ActualDialog {...props} />;
    },
  };
});

vi.mock('@/components/editor/LatexEditor', () => ({
  LatexEditor: ({ value, onChange, placeholder, lineWrapping }: {
    value: string; onChange: (value: string) => void; placeholder?: string; lineWrapping?: boolean;
  }) => {
    editorRenders.count += 1;
    return (
    <textarea
      aria-label="Source (LaTeX)"
      value={value}
      placeholder={placeholder}
      data-line-wrapping={String(!!lineWrapping)}
      onChange={(event) => onChange(event.target.value)}
    />
    );
  },
}));

const uploadMock = vi.mocked(uploadRepositorySource);

function setup(overrides: Partial<SourceUploadModalProps> = {}) {
  const props: SourceUploadModalProps = {
    open: true,
    owner: 'owner',
    repository: 'repo',
    onOpenChange: vi.fn(),
    onUploaded: vi.fn(),
    ...overrides,
  };
  const view = render(<SourceUploadModal {...props} />);
  return { props, ...view };
}

function chooseFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('#source-upload-modal-input');
  if (!input) throw new Error('missing upload input');
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  uploadMock.mockReset();
  editorRenders.count = 0;
  dialogLifecycle.onOpenChangeComplete = undefined;
});

describe('SourceUploadModal', () => {
  it('rejects unsupported files without advancing', () => {
    setup();
    chooseFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(screen.getByText('Upload a .tex, .md, .markdown, or .pdf file.'))
      .toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('states and enforces the 20 MB upload cap before upload', () => {
    setup();
    expect(screen.getByText(/Maximum 20 MB/)).toBeInTheDocument();

    chooseFile(new File(
      [new Uint8Array(20 * 1024 * 1024 + 1)],
      'huge.tex',
      { type: 'text/plain' },
    ));

    expect(screen.getByText('File is too large. Maximum upload size is 20 MB.'))
      .toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('accepts supported filename extensions case-insensitively', () => {
    setup();
    chooseFile(new File(['source'], 'NOTES.TEX', { type: 'text/plain' }));
    expect(screen.getByLabelText('Name')).toHaveValue('NOTES.TEX');
    expect(screen.getByText(/LaTeX/)).toBeInTheDocument();
  });

  it('prefills a supported filename and uploads an edited display name', async () => {
    const uploaded = { id: 'source-2', display_name: 'My Notes' };
    uploadMock.mockResolvedValue(uploaded as never);
    const { props } = setup();
    const file = new File(['pdf'], 'notes.pdf', { type: 'application/pdf' });
    chooseFile(file);
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('notes.pdf');
    fireEvent.change(name, { target: { value: 'My Notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith('owner', 'repo', file, {
      displayName: 'My Notes', projectScoped: false, blueprintId: '',
    }));
    expect(props.onUploaded).toHaveBeenCalledWith(uploaded);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('writes typed LaTeX as a source.tex upload', async () => {
    uploadMock.mockResolvedValue({ id: 'source-3' } as never);
    setup({ mode: 'write' });
    const submit = screen.getByRole('button', { name: 'Add source' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lecture notes' } });
    fireEvent.change(screen.getByLabelText('Source (LaTeX)'), {
      target: { value: '\\section{Intro}' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledOnce());
    const [, , file, options] = uploadMock.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('source.tex');
    expect(await file.text()).toBe('\\section{Intro}');
    expect(options).toMatchObject({ displayName: 'Lecture notes', projectScoped: false });
  });

  it('starts with an empty editor every time it opens', () => {
    const { props, rerender } = setup({ mode: 'write' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Old source' } });
    fireEvent.change(screen.getByLabelText('Source (LaTeX)'), {
      target: { value: '\\section{Old}' },
    });

    rerender(<SourceUploadModal {...props} open={false} />);
    rerender(<SourceUploadModal {...props} open />);

    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Source (LaTeX)')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  it('wraps long lines in the write-mode editor', () => {
    setup({ mode: 'write' });
    expect(screen.getByLabelText('Source (LaTeX)'))
      .toHaveAttribute('data-line-wrapping', 'true');
  });

  // Typing used to push every keystroke through dialog state, re-rendering the
  // whole dialog each time. Only the transition to non-empty may re-render now.
  it('does not re-render the dialog while typing source text', () => {
    setup({ mode: 'write' });
    const editor = screen.getByLabelText('Source (LaTeX)');
    fireEvent.change(editor, { target: { value: '\\section{a}' } });
    const rendersAfterFirstKeystroke = editorRenders.count;

    fireEvent.change(editor, { target: { value: '\\section{ab}' } });
    fireEvent.change(editor, { target: { value: '\\section{abc}' } });
    fireEvent.change(editor, { target: { value: '\\section{abcd}' } });

    expect(editorRenders.count).toBe(rendersAfterFirstKeystroke);
  });

  // Live backdrop sampling re-blurred the viewport on every keystroke, so write
  // mode swaps it for a one-off blur of the page itself.
  it('blurs the page instead of the overlay in write mode', () => {
    const pageRoot = document.createElement('div');
    pageRoot.id = 'root';
    document.body.appendChild(pageRoot);
    try {
      const { unmount } = setup({ mode: 'write' });
      expect(pageRoot).toHaveClass('page-behind-dialog-blurred');
      const writeOverlay = document.querySelector('[data-slot="dialog-overlay"]');
      expect(writeOverlay?.className).toContain('backdrop-blur-none');
      expect(writeOverlay?.className).not.toContain('backdrop-blur-xs');

      // The page must be handed back unblurred, or it stays soft afterwards.
      unmount();
      expect(pageRoot).not.toHaveClass('page-behind-dialog-blurred');

      setup({ mode: 'upload' });
      expect(pageRoot).not.toHaveClass('page-behind-dialog-blurred');
      const uploadOverlay = document.querySelector('[data-slot="dialog-overlay"]');
      expect(uploadOverlay?.className).toContain('backdrop-blur-xs');
    } finally {
      pageRoot.remove();
    }
  });

  it('leaves the page unblurred while closed', () => {
    const pageRoot = document.createElement('div');
    pageRoot.id = 'root';
    document.body.appendChild(pageRoot);
    try {
      setup({ mode: 'write', open: false });
      expect(pageRoot).not.toHaveClass('page-behind-dialog-blurred');
    } finally {
      pageRoot.remove();
    }
  });

  it('keeps the page blurred until the close animation completes', () => {
    const pageRoot = document.createElement('div');
    pageRoot.id = 'root';
    document.body.appendChild(pageRoot);
    try {
      const { props, rerender } = setup({ mode: 'write' });
      expect(pageRoot).toHaveClass('page-behind-dialog-blurred');

      rerender(<SourceUploadModal {...props} open={false} />);
      expect(pageRoot).toHaveClass('page-behind-dialog-blurred');

      act(() => dialogLifecycle.onOpenChangeComplete?.(false));
      expect(pageRoot).not.toHaveClass('page-behind-dialog-blurred');
    } finally {
      pageRoot.remove();
    }
  });

  it('blocks case-insensitive display-name collisions', () => {
    setup({ mode: 'write', existingNames: ['Lecture notes'] });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'lecture NOTES' } });
    fireEvent.change(screen.getByLabelText('Source (LaTeX)'), { target: { value: 'content' } });
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  it('limits source names to 120 characters', () => {
    setup({ mode: 'write' });
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('maxlength', '120');
    fireEvent.change(name, { target: { value: 'x'.repeat(121) } });
    fireEvent.change(screen.getByLabelText('Source (LaTeX)'), { target: { value: 'content' } });
    expect(screen.getByText('Source names must be 120 characters or fewer.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  it('defaults workspace uploads to workspace-only scope', async () => {
    const { unmount } = setup();
    expect(screen.queryByText('Workspace only')).not.toBeInTheDocument();
    unmount();
    uploadMock.mockResolvedValue({ id: 'workspace-source' } as never);
    setup({ blueprintId: 'my-blueprint' });
    const file = new File(['pdf'], 'notes.pdf', { type: 'application/pdf' });
    chooseFile(file);
    expect(screen.getByText('Workspace only')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Workspace only/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith('owner', 'repo', file, {
      displayName: 'notes.pdf', projectScoped: true, blueprintId: 'my-blueprint',
    }));
  });

  it('does not reset an open upload when blueprint context changes', () => {
    const { props, rerender } = setup({ blueprintId: 'alpha' });
    chooseFile(new File(['pdf'], 'notes.pdf', { type: 'application/pdf' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My notes' } });

    rerender(<SourceUploadModal {...props} blueprintId="beta" />);

    expect(screen.getByLabelText('Name')).toHaveValue('My notes');
    expect(screen.getByRole('switch', { name: /Workspace only/ })).toBeChecked();
  });

  it('cancels without uploading', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
