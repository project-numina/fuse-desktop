/**
 * Pure translation between blueprint declarations and ELK's graph model.
 *
 * The component owns the async, side-effecting parts of layout — lazily
 * importing elkjs, measuring node DOM, and committing the result into a
 * reactive ref. The shape-shuffling around that (building ELK's input graph
 * from entries + measured dimensions, then mapping ELK's output back into the
 * centre-anchored nodes and polyline edges the template renders) is pure and
 * lives here so it can be unit-tested without a browser or the ELK worker.
 */

import type { GraphNodeDimensions } from '@/features/blueprint/lib/graph-node-sizing';
import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';
import type { EdgePoint } from '@/features/blueprint/lib/edge-path';

export interface LaidOutNode extends ParsedEntry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge {
  source: string;
  target: string;
  points: EdgePoint[];
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export const EMPTY_LAYOUT: Layout = { nodes: [], edges: [], width: 0, height: 0 };

// ELK's "layered" algorithm is a proper Sugiyama implementation with
// real edge routing (vs dagre's polyline-through-rank-points). ORTHOGONAL
// routing gives clean right-angle bends that the Q-curve smoother then
// rounds into a flowing curve — best of both worlds.
export const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '44',
  'elk.layered.spacing.nodeNodeBetweenLayers': '88',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '24',
  'elk.padding': '[top=32,left=32,bottom=32,right=32]',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Brandes-Köpf with BALANCED alignment produces more symmetric and
  // visually pleasing layouts than NETWORK_SIMPLEX, at the cost of a
  // wider canvas. With this many small graphs it's the right trade.
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.nodePlacement.bk.edgeStraightening': 'IMPROVE_STRAIGHTNESS',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // Higher thoroughness runs more iterations of crossing minimization.
  // 10 is reasonable for blueprint-sized graphs (<200 nodes).
  'elk.layered.thoroughness': '10',
  'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

interface ElkNode {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface ElkEdge {
  sources: string[];
  targets: string[];
  sections?: {
    startPoint: EdgePoint;
    bendPoints?: EdgePoint[];
    endPoint: EdgePoint;
  }[];
}

export interface ElkGraphInput {
  id: string;
  layoutOptions: typeof ELK_OPTIONS;
  children: { id: string; width: number; height: number }[];
  edges: { id: string; sources: string[]; targets: string[] }[];
}

export interface ElkGraphResult {
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
}

/**
 * Assembles ELK's input graph from the entries and their measured pixel
 * dimensions. ``\uses`` references to labels that aren't entries (typos,
 * Mathlib refs) are silently dropped rather than rendered as dangling arrows.
 */
export function buildElkGraph(
  entries: ParsedEntry[],
  nodeDimensions: Map<string, GraphNodeDimensions>,
  fallbackDimensions: GraphNodeDimensions,
): ElkGraphInput {
  const labelSet = new Set(entries.map(entry => entry.label));

  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const entry of entries) {
    for (const dependency of entry.uses) {
      if (labelSet.has(dependency)) {
        elkEdges.push({
          id: `${dependency}->${entry.label}`,
          sources: [dependency],
          targets: [entry.label],
        });
      }
    }
  }

  return {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: entries.map((entry) => {
      const dimensions = nodeDimensions.get(entry.label) ?? fallbackDimensions;
      return {
        id: entry.label,
        width: dimensions.width,
        height: dimensions.height,
      };
    }),
    edges: elkEdges,
  };
}

/**
 * Maps ELK's laid-out graph back into the render model: nodes anchored at
 * their centre (ELK reports the top-left corner) and edges as flattened
 * polylines from each section's start/bend/end points.
 */
export function mapElkResult(
  result: ElkGraphResult,
  entries: ParsedEntry[],
  fallbackDimensions: GraphNodeDimensions,
): Layout {
  const entryByLabel = new Map(entries.map(entry => [entry.label, entry]));

  const nodes: LaidOutNode[] = (result.children ?? []).map((node) => {
    const entry = entryByLabel.get(node.id as string)!;
    const nodeWidth = node.width ?? fallbackDimensions.width;
    const nodeHeight = node.height ?? fallbackDimensions.height;
    return {
      ...entry,
      x: (node.x ?? 0) + nodeWidth / 2,
      y: (node.y ?? 0) + nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
    };
  });

  // Each edge has one section in the layered algorithm; the section's
  // startPoint + bendPoints + endPoint form the polyline we render.
  const edges: LaidOutEdge[] = (result.edges ?? []).map((edge) => {
    const section = edge.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : [];
    return {
      source: edge.sources[0],
      target: edge.targets[0],
      points: points.map(point => ({ x: point.x, y: point.y })),
    };
  });

  return {
    nodes,
    edges,
    width: result.width ?? 0,
    height: result.height ?? 0,
  };
}
