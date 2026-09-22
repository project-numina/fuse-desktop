import type { SubagentStream } from '@/features/chat/state/types';

/**
 * Human-readable lifecycle word for a subagent row. The visual status is an
 * 8px colour dot, which is invisible to screen readers and indistinguishable
 * for colour-blind users, so every row pairs the dot with this label rendered
 * visually hidden (WCAG 1.4.1).
 */
const STATUS_LABELS: Record<SubagentStream['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  proved: 'Proved',
  failed: 'Failed',
  cancelled: 'Cancelled',
  done: 'Done',
};

export function subagentStatusLabel(status: SubagentStream['status']): string {
  return STATUS_LABELS[status] ?? status;
}
