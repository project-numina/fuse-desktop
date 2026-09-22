/**
 * The blueprint kind vocabularies are shared with the renderer's parser.
 *
 * Blueprints are parsed twice: in the main process through `./blueprint` and
 * in the renderer through the LaTeX parser modules. Both must recognize exactly
 * the same environments, or a round-trip through the UI silently drops the
 * blocks only one side can see. The renderer keeps its constants private, so
 * they are read out of the source text the way the reference parity test did.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECLARATION_KINDS, PROOF_REQUIRED_KINDS } from '@main/services/blueprint/latex/blueprint';

const RENDERER_SRC = path.resolve(__dirname, '../../../../../src/renderer/src');
const DECLARATION_KIND_SOURCE = path.join(RENDERER_SRC, 'features/blueprint/hooks/latex-parser/syntax.ts');
const PROOF_REQUIRED_SOURCE = path.join(RENDERER_SRC, 'lib/declaration-kind.ts');

/** The quoted string literals of one TypeScript array or Set constant. */
function stringArray(source: string, name: string): string[] {
  const text = fs.readFileSync(source, 'utf8');
  const match = new RegExp(`const ${name} = (?:new Set\\(\\[|\\[)(.*?)\\]`, 's').exec(text);
  expect(match, `${name} not found in ${source}`).not.toBeNull();
  return [...match![1].matchAll(/'([^']*)'/g)].map((item) => item[1]);
}

describe('renderer parity', () => {
  it('recognizes the same declaration kinds as the renderer parser', () => {
    expect(stringArray(DECLARATION_KIND_SOURCE, 'DECLARATION_KINDS')).toEqual([...DECLARATION_KINDS]);
  });

  it('agrees with the renderer on which kinds carry a proof obligation', () => {
    expect(new Set(stringArray(PROOF_REQUIRED_SOURCE, 'PROOF_REQUIRED_KINDS'))).toEqual(PROOF_REQUIRED_KINDS);
  });
});
