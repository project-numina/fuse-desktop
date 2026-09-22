import { memo, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { sharedKatexOptions } from '@/lib/katex-config';
import { type MacroDict, EMPTY_MACROS, toKatexMacros } from '@/lib/latex-macros';

/**
 * Renders a chat message's Markdown `text` with GFM and math support while
 * threading the blueprint's KaTeX macros through. Rendering is memoized on
 * `text` and `macros` so transcript updates do not re-parse unchanged blocks.
 */

/**
 * Normalise the LaTeX delimiters agent prose emits that remark-math cannot parse
 * on its own — `\( … \)` → `$ … $` and `\[ … \]` / single-line `$$ … $$` →
 * fenced display blocks — while leaving code spans and fenced blocks verbatim.
 * Code spans and fenced blocks are excluded from delimiter rewriting.
 */
function normalizeMathDelimiters(text: string): string {
  if (!text) return text;
  const displayBlock = (inner: string) => `\n\n$$\n${inner.trim()}\n$$\n\n`;
  const transform = (s: string): string =>
    s
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => displayBlock(inner))
      .replace(
        /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
        (_m, inner) => displayBlock(inner),
      )
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner.trim()}$`)
      .replace(/\$\$([^\n$]+?)\$\$/g, (_m, inner) => displayBlock(inner))
      .replace(/\\(?:eq)?ref\{([^}]*)\}/g, (_m, label) => `(${label})`)
      .replace(/\\label\{[^}]*\}/g, '');

  const codePattern = /```[\s\S]*?```|`[^`\n]*`/g;
  let result = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = codePattern.exec(text)) !== null) {
    result += transform(text.slice(last, match.index));
    result += match[0];
    last = match.index + match[0].length;
  }
  result += transform(text.slice(last));
  return result;
}

interface ChatMarkdownProps {
  text: string;
  macros?: MacroDict;
}

function ChatMarkdownImpl({ text, macros = EMPTY_MACROS }: ChatMarkdownProps) {
  const source = useMemo(() => normalizeMathDelimiters(text), [text]);
  const katexOptions = useMemo(
    () => ({ ...sharedKatexOptions, macros: toKatexMacros(macros) }),
    [macros],
  );
  return (
    <div className="prose-bubble">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, katexOptions]]}
      >
        {source}
      </Markdown>
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownImpl);
export default ChatMarkdown;
