/** Reactive orchestration for LaTeX parsing, segmentation, and server metadata. */

import { useCallback, useMemo, useState } from 'react';

import { parseLatex } from './core';
import { buildLatexSegments } from './segments';
import { entriesToLatex, mergeParsedEntries } from './state';
import type {
  BlueprintEntry,
  LatexBlueprint,
  LatexSegment,
} from './types';

export { parseLatex } from './core';
export type { BlueprintEntry, LatexSegment } from './types';

export function useLatexParser(blueprint: LatexBlueprint | null) {
  const [latexSource, setLatexSource] = useState('');
  const localDocument = useMemo(() => parseLatex(latexSource), [latexSource]);

  const parsedEntries = useMemo<BlueprintEntry[]>(() => mergeParsedEntries(
    localDocument.entries,
    blueprint?.entries,
  ), [localDocument, blueprint]);

  const latexSegments = useMemo<LatexSegment[]>(() => {
    if (!latexSource) return [];
    return buildLatexSegments(latexSource, parsedEntries, localDocument.proofBlocks);
  }, [latexSource, parsedEntries, localDocument.proofBlocks]);

  const initFromBlueprint = useCallback(() => {
    const content = blueprint?.blueprint_content;
    if (content != null) {
      setLatexSource(content);
      return;
    }
    const entries = blueprint?.entries;
    setLatexSource(entries?.length ? entriesToLatex(entries) : '');
  }, [blueprint]);

  return {
    latexSource,
    setLatexSource,
    parsedEntries,
    latexSegments,
    initFromBlueprint,
  };
}
