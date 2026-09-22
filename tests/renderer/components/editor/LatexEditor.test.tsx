import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/editor/CodeEditor', () => ({
  CodeEditor: (props: Record<string, unknown>) => (
    <div
      data-testid="code-editor"
      data-language={String(props.language)}
      data-readonly={String(props.readonly)}
      data-latex-linting={String(props.latexLinting)}
      data-line-wrapping={String(props.lineWrapping)}
      data-placeholder={String(props.placeholder ?? '')}
    >
      {String(props.value ?? '')}
    </div>
  ),
}));

import { LatexEditor } from '@/components/editor/LatexEditor';

describe('LatexEditor', () => {
  it('renders a linked file header and configures CodeEditor for LaTeX', () => {
    render(<LatexEditor value="\\theorem" fileName="main.tex" fileUrl="https://example.test/main.tex" readonly />);
    const link = screen.getByRole('link', { name: /main\.tex/ });
    expect(link).toHaveAttribute('href', 'https://example.test/main.tex');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-language', 'latex');
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-readonly', 'true');
  });

  it('uses an unlinked default header when no URL is supplied', () => {
    render(<LatexEditor value="source" />);
    expect(screen.getByText('source.tex')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('forwards line wrapping to CodeEditor', () => {
    render(<LatexEditor value="source" lineWrapping />);
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-line-wrapping', 'true');
  });

  it('can disable LaTeX linting while retaining the LaTeX language', () => {
    render(<LatexEditor value="source" latexLinting={false} />);
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-language', 'latex');
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-latex-linting', 'false');
  });

  it('forwards placeholder text to CodeMirror', () => {
    render(<LatexEditor value="" placeholder="Paste LaTeX here" />);
    expect(screen.getByTestId('code-editor'))
      .toHaveAttribute('data-placeholder', 'Paste LaTeX here');
  });

  // Without a height on the container, the percentage height CodeEditor puts on
  // `.cm-editor` resolves against an auto-height parent, so the editor grows
  // with the document instead of scrolling inside the caller's box.
  it('fills the caller box when fillHeight is set, and does not otherwise', () => {
    const { container: filling } = render(<LatexEditor value="source" fillHeight />);
    const fillingStyle = (filling.firstElementChild as HTMLElement).style;
    expect(fillingStyle.height).toBe('100%');
    expect(parseFloat(fillingStyle.minHeight)).toBe(0);

    const { container: growing } = render(<LatexEditor value="source" fillHeight={false} />);
    expect((growing.firstElementChild as HTMLElement).style.height).toBe('');
  });
});
