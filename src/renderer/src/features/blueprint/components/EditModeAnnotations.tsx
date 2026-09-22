import type { CSSProperties } from 'react';

import MathText from '@/components/MathText';
import type { EditModeBlueprint } from '@/features/blueprint/components/EditMode';
import type { DeclarationSegment } from '@/features/blueprint/components/use-edit-mode-editor';
import { useStatus } from '@/hooks/use-status';
import { kindLabel } from '@/lib/display';
import { renderMath } from '@/lib/render-math';

interface StatusEntry {
  kind?: string;
  label: string;
  lean_name?: string;
  leanName?: string;
  status?: string;
}

interface AnnotationCardProps {
  segment: DeclarationSegment;
  top: number | undefined;
  entries: StatusEntry[];
  latexMacros?: Record<string, string>;
  scheduleLayout: () => void;
}

function cardStyle(top: number | undefined): CSSProperties {
  return top !== undefined
    ? { top: `${top}px` }
    : { top: '0px', visibility: 'hidden', pointerEvents: 'none' };
}

function AnnotationDetails({
  label,
  content,
  scheduleLayout,
  latexMacros,
}: {
  label: string;
  content: string;
  scheduleLayout: () => void;
  latexMacros?: Record<string, string>;
}) {
  return (
    <details className="ann-details" onToggle={scheduleLayout}>
      <summary>{label}</summary>
      <p
        className="rendered-math"
        dangerouslySetInnerHTML={{ __html: renderMath(content, latexMacros) }}
      />
    </details>
  );
}

function AnnotationUses({
  dependencies,
  scheduleLayout,
}: {
  dependencies: string[];
  scheduleLayout: () => void;
}) {
  if (dependencies.length === 0) return null;
  return (
    <details className="ann-details" onToggle={scheduleLayout}>
      <summary>Uses</summary>
      <div className="ann-deps">
        {dependencies.map((dependency) => (
          <span key={dependency} className="dep-tag">{dependency}</span>
        ))}
      </div>
    </details>
  );
}

function AnnotationCard({
  segment,
  top,
  entries,
  latexMacros,
  scheduleLayout,
}: AnnotationCardProps) {
  const { statusOf, statusBadge } = useStatus();
  const entry = segment.entry;
  const badge = statusBadge(statusOf(entry.label, entries), entry.label, entries);
  return (
    <div
      className="edit-card-position absolute left-0 right-0 py-[var(--space-1)]"
      style={cardStyle(top)}
    >
      <div className="math-card">
        <div className="card-header">
          <div className="card-header-badges">
            <span className="ann-badge">{kindLabel(entry.kind)}</span>
            <span className={`ann-status-badge ${badge.class}`}>{badge.text}</span>
          </div>
          <MathText className="ann-title" text={entry.title} macros={latexMacros} />
        </div>
        <div
          className="ann-statement rendered-math"
          dangerouslySetInnerHTML={{ __html: renderMath(entry.statement, latexMacros) }}
        />
        {entry.proof ? (
          <AnnotationDetails
            label="Proof"
            content={entry.proof}
            scheduleLayout={scheduleLayout}
            latexMacros={latexMacros}
          />
        ) : null}
        <AnnotationUses dependencies={entry.uses ?? []} scheduleLayout={scheduleLayout} />
      </div>
    </div>
  );
}

interface EditModeAnnotationsProps {
  segments: DeclarationSegment[];
  blueprint: EditModeBlueprint;
  topByKey: Record<string, number>;
  scheduleLayout: () => void;
}

export default function EditModeAnnotations({
  segments,
  blueprint,
  topByKey,
  scheduleLayout,
}: EditModeAnnotationsProps) {
  const entries = (blueprint.entries ?? []) as StatusEntry[];
  return (
    <div className="edit-card-pane relative flex-[2] min-w-0 max-w-[400px]">
      {segments.map((segment) => {
        // Occurrence keys keep duplicate labels in distinct layout slots.
        const declKey = segment.declKey ?? segment.entry.label;
        return (
          <AnnotationCard
            key={declKey}
            segment={segment}
            top={topByKey[declKey]}
            entries={entries}
            latexMacros={blueprint.latex_macros}
            scheduleLayout={scheduleLayout}
          />
        );
      })}
    </div>
  );
}
