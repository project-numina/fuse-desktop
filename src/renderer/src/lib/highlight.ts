/**
 * Pure utility functions for syntax-highlighting Lean 4 and LaTeX source code.
 * Uses highlight.js for Lean and Prism for LaTeX.
 *
 * can be shared by any code-display surface in the React app.
 */

import highlightJs from 'highlight.js/lib/core';
// `highlightjs-lean` is untyped; its module is declared ambiently in
import lean from 'highlightjs-lean';
import 'highlight.js/styles/github.css';
import Prism from 'prismjs';
import 'prismjs/components/prism-latex';

highlightJs.registerLanguage('lean', lean);

/**
 * @param code Lean 4 source code.
 * @return HTML string with syntax-highlighting spans.
 */
export function highlightLean(code: string): string {
  return highlightJs.highlight(code, { language: 'lean' }).value;
}

/**
 * @param code LaTeX source code.
 * @return HTML string with syntax-highlighting spans.
 */
export function highlightLatex(code: string): string {
  return Prism.highlight(code, Prism.languages.latex, 'latex');
}
