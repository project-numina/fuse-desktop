import { useCallback } from 'react';

import SectionSelector from '@/features/blueprint/components/SectionSelector';
import {
  GraphCanvas,
  GraphEmptyState,
  GraphMeasurementLayer,
} from '@/features/blueprint/components/graph/GraphCanvas';
import type { NodeStatus } from '@/features/blueprint/components/graph/GraphNodeCard';
import GraphToolbar from '@/features/blueprint/components/graph/GraphToolbar';
import { useGraphInteractions } from '@/features/blueprint/components/graph/use-graph-interactions';
import { useGraphLayout } from '@/features/blueprint/components/graph/use-graph-layout';
import type { ChapterDescriptor } from '@/features/blueprint/hooks/chapter';
import type { ParsedEntry } from '@/features/blueprint/lib/chapter-entries';
import { useStatus } from '@/hooks/use-status';

export interface GraphModeProps {
  parsedEntries: ParsedEntry[];
  activeChapterPath?: string;
  isActive?: boolean;
  latexMacros?: Record<string, string>;
  fitMargin?: number;
  fitMaxScale?: number;
  showControls?: boolean;
  chapters?: ChapterDescriptor[];
  onSelectChapter?: (path: string) => void;
}

interface GraphBodyProps {
  props: GraphModeProps;
  activeChapterPath: string;
  isActive: boolean;
  showControls: boolean;
}

function useGraphModel(
  props: GraphModeProps,
  activeChapterPath: string,
  isActive: boolean,
) {
  const { statusOf } = useStatus();
  const nodeStatus = useCallback(
    (entry: ParsedEntry): NodeStatus =>
      statusOf(entry.label, props.parsedEntries) as NodeStatus,
    [statusOf, props.parsedEntries],
  );
  const hasEntries = props.parsedEntries.length > 0;
  const { layout, measurementRef } = useGraphLayout(props.parsedEntries, isActive);
  const interactions = useGraphInteractions(
    layout,
    hasEntries,
    activeChapterPath,
    isActive,
    { fitMargin: props.fitMargin, fitMaxScale: props.fitMaxScale },
  );
  return { hasEntries, layout, measurementRef, interactions, nodeStatus };
}

function GraphMainContent({
  props,
  isActive,
  model,
}: {
  props: GraphModeProps;
  isActive: boolean;
  model: ReturnType<typeof useGraphModel>;
}) {
  if (!model.hasEntries) return <GraphEmptyState />;
  return (
    <>
      {isActive ? (
        <GraphMeasurementLayer
          entries={props.parsedEntries}
          nodeStatus={model.nodeStatus}
          latexMacros={props.latexMacros}
          measurementRef={model.measurementRef}
        />
      ) : null}
      <GraphCanvas
        nodeStatus={model.nodeStatus}
        latexMacros={props.latexMacros}
        layout={model.layout}
        containerRef={model.interactions.containerRef}
        viewportRef={model.interactions.viewportRef}
        onMouseDown={model.interactions.onCanvasMouseDown}
      />
    </>
  );
}

function GraphBody({ props, activeChapterPath, isActive, showControls }: GraphBodyProps) {
  const model = useGraphModel(props, activeChapterPath, isActive);
  return (
    <div className="graph-root relative flex h-full min-h-0 w-full flex-col bg-background">
      {showControls ? (
        <GraphToolbar hasEntries={model.hasEntries} {...model.interactions} />
      ) : null}
      <GraphMainContent props={props} isActive={isActive} model={model} />
      {props.chapters && props.onSelectChapter ? (
        <SectionSelector
          chapters={props.chapters}
          activePath={activeChapterPath}
          onSelect={props.onSelectChapter}
        />
      ) : null}
    </div>
  );
}

export default function GraphMode(props: GraphModeProps) {
  return (
    <GraphBody
      props={props}
      activeChapterPath={props.activeChapterPath ?? ''}
      isActive={props.isActive ?? true}
      showControls={props.showControls ?? true}
    />
  );
}
