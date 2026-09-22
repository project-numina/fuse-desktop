import {
  subagentPreviewLabel,
  type SubagentPreviewEntry,
} from '@/features/chat/components/subagents/subagent-card-preview';

interface SubagentPreviewListProps {
  entries: SubagentPreviewEntry[];
  className: string;
}

/** Shared row markup keeps labels truncatable without hiding repeat counts. */
export default function SubagentPreviewList({
  entries,
  className,
}: SubagentPreviewListProps) {
  return (
    <div className={className}>
      {entries.map((entry) => (
        <div key={entry.key} className="subagent-preview-row">
          <span className="subagent-preview-label">
            {subagentPreviewLabel(entry)}
          </span>
          {entry.kind === 'call' && entry.group.count > 1 ? (
            <span className="subagent-preview-count">({entry.group.count})</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
