import type { MacroDict } from '@/lib/latex-macros';
import type { ReferenceDict, StatusDict } from './scan-helpers';

export interface RenderContext {
  macros: MacroDict;
  statuses: StatusDict;
  references: ReferenceDict;
  linkedDeclarations: ReadonlySet<string>;
}

export type RecursiveRenderer = (
  input: string,
  depth: number,
  context: RenderContext,
) => string;
