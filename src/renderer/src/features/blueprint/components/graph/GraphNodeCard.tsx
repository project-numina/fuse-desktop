import type { MouseEvent } from 'react';

import MathText from '@/components/MathText';
import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';
import type { LaidOutNode } from '@/features/blueprint/lib/graph-layout';
import { kindLabel } from '@/lib/display';
import { cn } from '@/lib/utils';

export type NodeStatus = 'proved' | 'formalized' | 'not_started';

export const STATUS_LABEL: Record<NodeStatus, string> = {
  proved: 'Complete',
  formalized: 'Formalized',
  not_started: 'Unformalized',
};

export const STATUS_FILL: Record<NodeStatus, string> = {
  not_started: '#ef4444',
  formalized: '#eab308',
  proved: '#22c55e',
};

export const NODE_BASE_CLASS =
  'flex flex-col justify-center gap-1 overflow-hidden rounded-md border px-3.5 py-2.5 text-left';

export function GraphNodeContent({
  entry,
  status,
  latexMacros,
}: {
  entry: ParsedEntry;
  status: NodeStatus;
  latexMacros?: Record<string, string>;
}) {
  return (
    <>
      <span
        className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full"
        style={{ background: STATUS_FILL[status] }}
        aria-label={STATUS_LABEL[status]}
      />
      <MathText
        className={cn(
          'shrink-0 overflow-hidden text-sm font-medium leading-tight line-clamp-2',
          entry.isExternal ? 'text-muted-foreground' : 'text-foreground',
        )}
        text={entry.title || entry.label}
        macros={latexMacros}
      />
      {entry.leanName ? (
        <span className="shrink-0 truncate font-mono text-[0.65rem] leading-tight text-muted-foreground">
          {entry.leanName}
        </span>
      ) : null}
    </>
  );
}

export function MeasurementNode({
  entry,
  status,
  latexMacros,
}: {
  entry: ParsedEntry;
  status: NodeStatus;
  latexMacros?: Record<string, string>;
}) {
  return (
    <div
      data-node-label={entry.label}
      className={cn(
        NODE_BASE_CLASS,
        'mb-2 min-h-20 w-52 overflow-visible',
        entry.isExternal
          ? 'border-dashed border-border bg-transparent opacity-75'
          : 'border-border bg-card',
      )}
    >
      <GraphNodeContent entry={entry} status={status} latexMacros={latexMacros} />
    </div>
  );
}

export function LaidOutGraphNode({
  node,
  status,
  latexMacros,
}: {
  node: LaidOutNode;
  status: NodeStatus;
  latexMacros?: Record<string, string>;
}) {
  const stopCanvasPan = (event: MouseEvent) => event.stopPropagation();
  const externalTitle = node.isExternal ? ' — from another chapter' : '';
  return (
    <div
      className={cn(
        NODE_BASE_CLASS,
        'absolute text-foreground',
        node.isExternal
          ? 'border-dashed border-border bg-transparent opacity-75'
          : 'border-border bg-card',
      )}
      style={{
        left: `${node.x - node.width / 2}px`,
        top: `${node.y - node.height / 2}px`,
        width: `${node.width}px`,
        height: `${node.height}px`,
      }}
      title={`${kindLabel(node.kind)} — ${STATUS_LABEL[status]}${externalTitle}`}
      onMouseDown={stopCanvasPan}
    >
      <GraphNodeContent entry={node} status={status} latexMacros={latexMacros} />
    </div>
  );
}
