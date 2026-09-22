import type { MouseEventHandler, RefObject } from 'react';

import {
  LaidOutGraphNode,
  MeasurementNode,
  type NodeStatus,
} from '@/features/blueprint/components/graph/GraphNodeCard';
import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';
import { smoothEdgePath } from '@/features/blueprint/lib/edge-path';
import type { Layout } from '@/features/blueprint/lib/graph-layout';

const EDGE_STROKE = '#c8bda9';
const EDGE_ARROW_FILL = '#b8ad99';

interface SharedGraphProps {
  entries: ParsedEntry[];
  nodeStatus: (entry: ParsedEntry) => NodeStatus;
  latexMacros?: Record<string, string>;
}

export function GraphMeasurementLayer({
  entries,
  nodeStatus,
  latexMacros,
  measurementRef,
}: SharedGraphProps & { measurementRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={measurementRef}
      aria-hidden="true"
      className="pointer-events-none invisible absolute left-[-10000px] top-0 -z-10 h-0 w-0 overflow-visible"
    >
      {entries.map((entry) => (
        <MeasurementNode
          key={`measure-${entry.label}`}
          entry={entry}
          status={nodeStatus(entry)}
          latexMacros={latexMacros}
        />
      ))}
    </div>
  );
}

export function GraphEmptyState() {
  return (
    <div className="flex flex-1 items-start justify-center bg-background px-6 pb-6 pt-[clamp(3.5rem,34vh,40rem)]">
      <div className="flex max-w-80 flex-col items-center gap-3 text-center">
        <p className="text-lg font-semibold text-foreground">No declarations yet</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Add definitions, lemmas, or theorems in the{' '}
          <strong className="font-semibold text-foreground">Blueprint</strong> tab and
          they&apos;ll show up here as a dependency graph.
        </p>
      </div>
    </div>
  );
}

function GraphEdges({ layout }: { layout: Layout }) {
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={layout.width}
      height={layout.height}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="graph-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={EDGE_ARROW_FILL} />
        </marker>
      </defs>
      {layout.edges.map((edge) => (
        <path
          key={`${edge.source}->${edge.target}`}
          d={smoothEdgePath(edge.points)}
          fill="none"
          stroke={EDGE_STROKE}
          strokeWidth={1.25}
          markerEnd="url(#graph-arrow)"
        />
      ))}
    </svg>
  );
}

interface GraphCanvasProps {
  nodeStatus: (entry: ParsedEntry) => NodeStatus;
  latexMacros?: Record<string, string>;
  layout: Layout;
  containerRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
}

export function GraphCanvas({
  nodeStatus,
  latexMacros,
  layout,
  containerRef,
  viewportRef,
  onMouseDown,
}: GraphCanvasProps) {
  return (
    <div
      ref={containerRef}
      className="relative w-full flex-1 min-h-0 cursor-grab select-none overflow-hidden bg-background active:cursor-grabbing"
      onMouseDown={onMouseDown}
    >
      <div
        ref={viewportRef}
        className="absolute left-0 top-0"
        style={{
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          transformOrigin: '0 0',
        }}
      >
        <GraphEdges layout={layout} />
        {layout.nodes.map((node) => (
          <LaidOutGraphNode
            key={node.label}
            node={node}
            status={nodeStatus(node)}
            latexMacros={latexMacros}
          />
        ))}
      </div>
    </div>
  );
}
