import { Fragment, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BucketEntry } from '../hooks/chat-turns';

function ToolGroup({ count, errors, children }: { count: number; errors: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className="chat-tool-group">
      <button type="button" className="chat-tool-group-toggle" aria-label={`${count} tool calls${errors > 0 ? `, ${errors} failed` : ''}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
        <span>{count} tool calls</span>
        {errors > 0 && <span className="chat-tool-group-errors"> {errors} failed</span>}
        {expanded ? <ChevronDown className="chat-tool-group-chevron" size={16} aria-hidden="true" /> : <ChevronRight className="chat-tool-group-chevron" size={16} aria-hidden="true" />}
      </button>
      <div id={id} className="chat-tool-group-content" hidden={!expanded}>{children}</div>
    </div>
  );
}

/** Fold consecutive tools without moving them past text, subagents, or approvals. */
export default function ActivityBucket({ entries, keyPrefix, renderEntry }: {
  entries: BucketEntry[];
  keyPrefix: string;
  renderEntry: (entry: BucketEntry, key: string) => ReactNode;
}) {
  const content: ReactNode[] = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index];
    if (entry.kind !== 'activity') {
      content.push(renderEntry(entry, `${keyPrefix}-${entry.key}`));
      index += 1;
      continue;
    }
    const run: BucketEntry[] = [];
    let count = 0;
    let errors = 0;
    while (index < entries.length && entries[index].kind === 'activity') {
      const tool = entries[index] as Extract<BucketEntry, { kind: 'activity' }>;
      run.push(tool);
      count += tool.count;
      if (tool.activity.isError) errors += tool.count;
      index += 1;
    }
    const rows = run.map((tool) => renderEntry(tool, `${keyPrefix}-${tool.key}`));
    content.push(count > 3
      ? <ToolGroup key={entry.key} count={count} errors={errors}>{rows}</ToolGroup>
      : <Fragment key={entry.key}>{rows}</Fragment>);
  }
  return <>{content}</>;
}
