/**
 * Shared KaTeX rendering options used by both the blueprint LaTeX
 * renderer (mathRender.ts) and the chat Markdown renderer
 * (renderChatMessage.ts). Centralises math behaviour so inline and
 * display math look the same everywhere in the app.
 */

import type { KatexOptions } from 'katex';

export const sharedKatexOptions: Partial<KatexOptions> = {
  throwOnError: false,
  trust: false,
  maxExpand: 200,
  maxSize: 10,
};
