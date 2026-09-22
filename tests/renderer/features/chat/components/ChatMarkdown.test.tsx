import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMarkdown } from '@/features/chat/components/ChatMarkdown';

describe('ChatMarkdown', () => {
  it('renders GFM prose, links, and tables', () => {
    render(<ChatMarkdown text={'**bold** [docs](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |'} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it.each([
    ['inline \\(x^2\\) math', 'x2'],
    ['display \\[x+y\\] math', 'x+y'],
    ['equation \\begin{equation}a=b\\end{equation}', 'a=b'],
    ['single-line $$c=d$$ math', 'c=d'],
  ])('normalizes agent LaTeX delimiters in %j', (text, accessibleText) => {
    const { container } = render(<ChatMarkdown text={text} />);
    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.textContent).toContain(accessibleText);
  });

  it('keeps delimiters inside inline and fenced code verbatim', () => {
    render(<ChatMarkdown text={'`\\(not math\\)`\n\n```tex\n\\[also code\\]\n```'} />);
    expect(screen.getByText('\\(not math\\)')).toBeInTheDocument();
    expect(screen.getByText('\\[also code\\]')).toBeInTheDocument();
  });

  it('replaces references and removes labels from prose', () => {
    const { container } = render(<ChatMarkdown text={'See \\eqref{main}. \\label{hidden}'} />);
    expect(container.textContent).toContain('See (main).');
    expect(container.textContent).not.toContain('hidden');
  });

  it('threads custom macros into KaTeX', () => {
    const { container } = render(<ChatMarkdown text={'$\\RR$'} macros={{ '\\RR': '\\mathbb{R}' }} />);
    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.textContent).toContain('R');
  });
});
