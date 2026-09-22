import { EMPTY_MACROS, type MacroDict } from '@/lib/latex-macros';
import { scanToHtml } from '@/lib/render-math/scanner';
import type { RenderContext } from '@/lib/render-math/render-types';
import type { ReferenceDict, StatusDict } from '@/lib/render-math/scan-helpers';

export { escapeHtml } from '@/lib/render-math/scan-helpers';
export type { ReferenceDict, StatusDict } from '@/lib/render-math/scan-helpers';

const EMPTY_STATUSES: StatusDict = Object.freeze({}) as StatusDict;
const EMPTY_REFERENCES: ReferenceDict = Object.freeze({}) as ReferenceDict;
const EMPTY_LINKED_DECLARATIONS: ReadonlySet<string> = new Set();

/** Convert supported LaTeX prose and math into escaped, display-ready HTML. */
export function renderMath(
  text: string,
  macros: MacroDict = EMPTY_MACROS,
  statuses: StatusDict = EMPTY_STATUSES,
  references: ReferenceDict = EMPTY_REFERENCES,
  linkedDeclarations: ReadonlySet<string> = EMPTY_LINKED_DECLARATIONS,
): string {
  if (!text) return '';
  const context: RenderContext = {
    macros,
    statuses,
    references,
    linkedDeclarations,
  };
  return scanToHtml(text, 0, context);
}
