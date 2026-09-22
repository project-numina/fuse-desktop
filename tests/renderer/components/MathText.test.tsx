import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MathText from '@/components/MathText';

describe('MathText', () => {
  it('renders inline LaTeX with KaTeX', () => {
    const { container } = render(
      <MathText
        text={String.raw`Dirichlet eigenvalues of $-y'' = \lambda y$ are $n^2$`}
        preservePlainText
      />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.textContent).not.toContain('$');
  });

  it('supports blueprint LaTeX macros', () => {
    const { container } = render(
      <MathText
        text={String.raw`Over $\RR$`}
        macros={{ RR: String.raw`\mathbb{R}` }}
        preservePlainText
      />,
    );

    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument();
  });

  it('escapes HTML in titles', () => {
    const { container } = render(
      <MathText text={'A <script>alert("xss")</script> title'} preservePlainText />,
    );

    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.textContent).toContain('<script>alert("xss")</script>');
  });

  it('preserves LaTeX-special characters in free-form titles', () => {
    const text = String.raw`Optimization 100% complete; back\slash; Title {braced}; R&D #1`;
    const { container } = render(<MathText text={text} preservePlainText />);

    expect(container.textContent).toBe(text);
  });

  it('does not interpret paired currency amounts as math', () => {
    const text = 'Price $5 and $10';
    const { container } = render(<MathText text={text} preservePlainText />);

    expect(container.querySelector('.katex')).not.toBeInTheDocument();
    expect(container.textContent).toBe(text);
  });

  it('retains supported LaTeX formatting in imported titles', () => {
    const { container } = render(
      <MathText text={String.raw`\emph{A title with $x$}`} preservePlainText />,
    );

    expect(container.querySelector('em')).toHaveTextContent('A title with');
    expect(container.querySelector('.katex')).toBeInTheDocument();
  });
});
