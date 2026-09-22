import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepositorySource } from '@/lib/api';

import SourceMode from '@/features/blueprint/components/SourceMode';

vi.mock('@codemirror/view', () => ({
  EditorView: {
    updateListener: { of: (listener: unknown) => listener },
  },
}));

vi.mock('@/components/editor/LatexEditor', () => ({
  LatexEditor: ({
    value, fileName, fileUrl, readonly, latexLinting, extensions = [],
  }: {
    value: string; fileName: string; fileUrl: string; readonly: boolean;
    latexLinting?: boolean;
    extensions?: Array<(update: unknown) => void>;
  }) => (
    <div>
      <div
        data-testid="latex-editor"
        data-name={fileName}
        data-url={fileUrl}
        data-readonly={readonly}
        data-latex-linting={String(latexLinting)}
      >
        {value}
      </div>
      <button
        type="button"
        onClick={() => extensions[0]?.({
          selectionSet: true,
          docChanged: false,
          state: {
            selection: { main: { from: 6, to: 18, empty: false } },
            doc: { lineAt: (position: number) => ({ number: position < 12 ? 2 : 3 }) },
            sliceDoc: () => 'selected theorem',
          },
        })}
      >
        Select source text
      </button>
    </div>
  ),
}));

vi.mock('@/features/blueprint/components/PdfViewer', () => ({
  default: ({ url, title }: { url: string; title: string }) => (
    <div data-testid="pdf-viewer" data-url={url} data-title={title} />
  ),
}));

function source(overrides: Partial<RepositorySource> = {}): RepositorySource {
  return {
    id: 'source-1', github_repo_id: 1, owner: 'owner', repo_name: 'repo',
    display_name: 'paper.tex', source_type: 'latex', status: 'ready', artifacts: ['original'],
    metadata: {}, created_at: '2026-06-16T00:00:00Z', updated_at: '2026-06-16T00:00:00Z',
    ...overrides,
  } as RepositorySource;
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('SourceMode', () => {
  it('renders legacy inline source in a read-only editor', () => {
    render(<SourceMode blueprint={{
      id: 'froda', source_type: 'latex', source_content: 'legacy content',
      source_file_url: '/legacy/source',
    }} />);
    expect(screen.getByTestId('latex-editor')).toHaveTextContent('legacy content');
    expect(screen.getByTestId('latex-editor')).toHaveAttribute('data-name', 'froda-source.tex');
    expect(screen.getByTestId('latex-editor')).toHaveAttribute('data-readonly', 'true');
  });

  it('renders an authenticated PDF artifact and switches to fetched OCR', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 206,
      headers: new Headers({ 'Content-Range': 'bytes 0-10/11' }),
      text: async () => 'OCR content',
    } as Response);
    const pdf = source({
      source_type: 'pdf', display_name: 'scan.pdf', artifacts: ['original', 'ocr'],
    });
    render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[pdf]} selectedSourceId={pdf.id}
      owner="owner name" repo="Repo Name" blueprintId="my blueprint"
    />);
    const viewer = await screen.findByTestId('pdf-viewer');
    expect(viewer).toHaveAttribute(
      'data-url',
      '/api/repositories/owner%20name/Repo%20Name/sources/source-1/pdf-preview?blueprint_id=my%20blueprint',
    );
    expect(viewer).toHaveAttribute('data-title', 'scan.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'OCR' }));
    expect(await screen.findByText('OCR content')).toBeInTheDocument();
    expect(screen.getByTestId('latex-editor')).toHaveAttribute('data-latex-linting', 'false');
    expect(screen.queryByText(/Preview limited/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/repositories/owner%20name/Repo%20Name/sources/source-1/artifacts/ocr?blueprint_id=my%20blueprint',
      { credentials: 'include', headers: { Range: 'bytes=0-65535' } },
    );
  });

  it('bounds managed text previews before mounting the editor', async () => {
    const oversizedText = 'x'.repeat(64 * 1024 + 10);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => oversizedText,
    } as Response);
    const tex = source({ artifacts: ['latex'] });

    render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[tex]} selectedSourceId={tex.id}
      owner="owner" repo="repo"
    />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Preview limited to the first 64 KB.',
    );
    expect(screen.getByTestId('latex-editor').textContent).toHaveLength(64 * 1024);
    expect(screen.getByRole('link', { name: 'Open the full source' })).toHaveAttribute(
      'href',
      '/api/repositories/owner/repo/sources/source-1/artifacts/latex',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/repositories/owner/repo/sources/source-1/artifacts/latex',
      { credentials: 'include', headers: { Range: 'bytes=0-65535' } },
    );
  });

  it('does not expose protected PDF previews on public shares', () => {
    const pdf = source({ source_type: 'pdf', display_name: 'scan.pdf', artifacts: ['original'] });
    render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[pdf]} selectedSourceId={pdf.id}
      owner="owner" repo="repo" publicShare
    />);
    expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not overlay chat attachment controls on PDFs', () => {
    const pdf = source({
      source_type: 'pdf', display_name: 'scan.pdf', artifacts: ['original'],
    });
    render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[pdf]} selectedSourceId={pdf.id}
      owner="owner" repo="repo" onAttachContext={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: 'Attach to chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('attaches selected source lines to chat', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => 'first line\nselected theorem\nlast line',
    } as Response);
    const onAttachContext = vi.fn();
    const tex = source({ artifacts: ['original'] });
    render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[tex]} selectedSourceId={tex.id}
      owner="owner" repo="repo" onAttachContext={onAttachContext}
    />);
    await screen.findByText('first line', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: 'Select source text' }));
    expect(screen.getByText('lines 2-3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attach to chat' }));
    expect(onAttachContext).toHaveBeenCalledWith(expect.objectContaining({
      source_id: 'source-1', artifact_kind: 'original',
      selection: { kind: 'line_range', start_line: 2, end_line: 3 },
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Attached lines 2-3');
  });

  it('shows a safe source-text failure without stale content', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const tex = source({ artifacts: ['latex'] });
    render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[tex]} selectedSourceId={tex.id}
      owner="owner" repo="repo"
    />);
    expect(await screen.findByText('Source text is unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('latex-editor')).not.toBeInTheDocument();
  });

  it('ignores a stale source fetch after selection changes', async () => {
    let resolveFirst!: (response: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, text: async () => 'second content' } as Response);
    const first = source({ id: 'first', display_name: 'first.tex' });
    const second = source({ id: 'second', display_name: 'second.tex' });
    const { rerender } = render(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[first, second]} selectedSourceId="first"
      owner="owner" repo="repo"
    />);
    rerender(<SourceMode
      blueprint={{ id: 'froda' }} repositorySources={[first, second]} selectedSourceId="second"
      owner="owner" repo="repo"
    />);
    expect(await screen.findByText('second content')).toBeInTheDocument();
    resolveFirst({ ok: true, text: async () => 'stale first content' } as Response);
    await waitFor(() => expect(screen.queryByText('stale first content')).not.toBeInTheDocument());
  });

  it('explains the empty selection', () => {
    render(<SourceMode blueprint={{ id: 'froda' }} />);
    expect(screen.getByText('No source selected')).toBeInTheDocument();
  });
});
