import { useCallback, useEffect, useRef, useState } from 'react';
import type { ELK } from 'elkjs/lib/elk-api';

import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';
import {
  buildElkGraph,
  EMPTY_LAYOUT,
  mapElkResult,
  type ElkGraphResult,
  type Layout,
} from '@/features/blueprint/lib/graph-layout';
import {
  graphNodeFallbackDimensions,
  readRootFontSizePixels,
  type GraphNodeDimensions,
} from '@/features/blueprint/lib/graph-node-sizing';

let elkInstance: ELK | null = null;

async function getElk(): Promise<ELK> {
  if (!elkInstance) {
    const module_ = await import('elkjs/lib/elk.bundled.js');
    elkInstance = new module_.default();
  }
  return elkInstance;
}

function fallbackNodeDimensions(): GraphNodeDimensions {
  return graphNodeFallbackDimensions(readRootFontSizePixels());
}

async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await document.fonts.ready;
}

function measuredElements(root: HTMLDivElement): Map<string, HTMLElement> {
  const elements = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-node-label]')) {
    const label = element.dataset.nodeLabel;
    if (label) elements.set(label, element);
  }
  return elements;
}

function readDimensions(
  entries: ParsedEntry[],
  elements: Map<string, HTMLElement>,
  fallback: GraphNodeDimensions,
): Map<string, GraphNodeDimensions> {
  return new Map(entries.map((entry) => {
    const element = elements.get(entry.label);
    if (!element) return [entry.label, fallback];
    const rect = element.getBoundingClientRect();
    return [entry.label, {
      width: Math.ceil(rect.width) || fallback.width,
      height: Math.ceil(rect.height) || fallback.height,
    }];
  }));
}

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

export function useGraphLayout(entries: ParsedEntry[], isActive: boolean) {
  const [layout, setLayout] = useState<Layout>(() => ({ ...EMPTY_LAYOUT }));
  const measurementRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const pendingRecomputeRef = useRef(false);
  const mountedRef = useMountedRef();
  const measure = useCallback(async () => {
    const fallback = fallbackNodeDimensions();
    await waitForFonts();
    const root = measurementRef.current;
    return root
      ? readDimensions(entries, measuredElements(root), fallback)
      : new Map(entries.map((entry) => [entry.label, fallback]));
  }, [entries]);
  const compute = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!isActive) {
      pendingRecomputeRef.current = true;
      return;
    }
    pendingRecomputeRef.current = false;
    if (!entries.length) {
      if (mountedRef.current) setLayout({ ...EMPTY_LAYOUT });
      return;
    }
    const dimensions = await measure();
    if (generation !== generationRef.current) return;
    const fallback = fallbackNodeDimensions();
    const elk = await getElk();
    const result = await elk.layout(buildElkGraph(entries, dimensions, fallback) as never);
    if (generation !== generationRef.current || !mountedRef.current) return;
    setLayout(mapElkResult(result as ElkGraphResult, entries, fallback));
  }, [entries, isActive, measure, mountedRef]);
  useEffect(() => { void compute(); }, [compute]);
  return { layout, measurementRef };
}
