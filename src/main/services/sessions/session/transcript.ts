import { randomUUID } from 'node:crypto';
import type { MessageDeliveryState } from '@shared/api-types';
import type { TranscriptRow } from '../../../store/rows';
import type { TranscriptWriter } from './types';

export class SessionTranscript implements TranscriptWriter {
  constructor(
    private readonly writer: TranscriptWriter,
    private readonly now: () => number,
    private readonly onBoundaryAdvanced: (eventId: number) => void,
  ) {}

  appendRow(row: TranscriptRow, boundaryEventId: number | null): void {
    this.writer.appendRow(row, boundaryEventId);
    if (boundaryEventId !== null) this.onBoundaryAdvanced(boundaryEventId);
  }

  setDeliveryState(messageId: string, state: MessageDeliveryState, options?: { preserveDeliveredAt?: boolean }): void {
    this.writer.setDeliveryState(messageId, state, options);
  }

  advanceBoundary(eventId: number): void {
    this.writer.advanceBoundary(eventId);
    this.onBoundaryAdvanced(eventId);
  }

  persistTool(content: Record<string, unknown>, boundaryEventId: number | null): void {
    this.appendRow(
      {
        id: randomUUID(),
        role: 'tool',
        content: JSON.stringify(content),
        created_at: new Date(this.now()).toISOString(),
        delivered_at: null,
        delivery_state: null,
        context_attachments: [],
        event_kind: typeof content.kind === 'string' ? content.kind : null,
        tool_name: typeof content.tool === 'string' ? content.tool : null,
        tool_use_id: typeof content.tool_use_id === 'string' ? content.tool_use_id : null,
        parent_tool_use_id: typeof content.parent_tool_use_id === 'string' ? content.parent_tool_use_id : null,
        is_subagent: content.is_subagent === true,
      },
      boundaryEventId,
    );
  }

  persistAgentText(text: string, boundaryEventId: number): void {
    this.appendRow(
      {
        id: randomUUID(),
        role: 'agent',
        content: text,
        created_at: new Date(this.now()).toISOString(),
        delivered_at: null,
        delivery_state: null,
        context_attachments: [],
        event_kind: null,
        tool_name: null,
        tool_use_id: null,
        parent_tool_use_id: null,
        is_subagent: false,
      },
      boundaryEventId,
    );
  }
}
