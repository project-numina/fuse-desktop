import { useMemo } from 'react';

import { renderInlineMathText } from '@/lib/inline-math-text';
import type { MacroDict } from '@/lib/latex-macros';
import { renderMath } from '@/lib/render-math';

interface MathTextProps {
  text: string;
  macros?: MacroDict;
  className?: string;
  preservePlainText?: boolean;
}

/**
 * Renders math-bearing text through the shared KaTeX pipeline. The generated
 * HTML contains escaped plain text plus KaTeX output configured with
 * `trust: false` and `throwOnError: false`; raw user HTML is never inserted.
 * `preservePlainText` limits parsing to valid inline-math delimiters for
 * free-form labels that are not necessarily LaTeX source.
 */
export default function MathText({
  text,
  macros,
  className,
  preservePlainText = false,
}: MathTextProps) {
  const html = useMemo(
    () => (preservePlainText ? renderInlineMathText(text, macros) : renderMath(text, macros)),
    [text, macros, preservePlainText],
  );

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
