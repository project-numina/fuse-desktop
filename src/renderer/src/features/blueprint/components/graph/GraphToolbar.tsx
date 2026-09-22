import {
  STATUS_FILL,
  STATUS_LABEL,
  type NodeStatus,
} from '@/features/blueprint/components/graph/GraphNodeCard';

const STATUSES: NodeStatus[] = ['not_started', 'formalized', 'proved'];

function StatusLegend() {
  return (
    <div className="pointer-events-none flex flex-row flex-wrap gap-2.5 px-2.5 py-1.5 text-[0.65rem] text-muted-foreground">
      {STATUSES.map((status) => (
        <span key={status} className="inline-flex items-center gap-[5px]">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_FILL[status] }} />
          {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

function ZoomButton({
  direction,
  onClick,
}: {
  direction: 'in' | 'out';
  onClick: () => void;
}) {
  const label = direction === 'in' ? 'Zoom in' : 'Zoom out';
  return (
    <button
      type="button"
      className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
      aria-label={label}
      onClick={onClick}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {direction === 'in' ? <line x1="7" y1="3" x2="7" y2="11" /> : null}
        <line x1="3" y1="7" x2="11" y2="7" />
      </svg>
    </button>
  );
}

function ZoomControls({
  zoomIn,
  zoomOut,
  fit,
}: {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5 border-t border-border p-1">
      <ZoomButton direction="out" onClick={zoomOut} />
      <ZoomButton direction="in" onClick={zoomIn} />
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        className="flex h-6 w-auto items-center justify-center rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
        aria-label="Fit graph to view"
        onClick={fit}
      >
        Fit
      </button>
    </div>
  );
}

export default function GraphToolbar({
  hasEntries,
  zoomIn,
  zoomOut,
  fit,
}: {
  hasEntries: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}) {
  return (
    <div className="graph-toolbar absolute bottom-4 left-4 z-[5] inline-flex max-w-[calc(100%-2rem)] flex-col items-stretch rounded-md border border-border bg-card shadow-sm">
      {hasEntries ? <StatusLegend /> : null}
      {hasEntries ? <ZoomControls zoomIn={zoomIn} zoomOut={zoomOut} fit={fit} /> : null}
    </div>
  );
}
