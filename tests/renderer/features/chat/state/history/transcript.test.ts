import { describe, expect, it } from 'vitest';

import {
  collectToolResults,
  indexesBeforeLaterUser,
  parseToolHistoryEvent,
  TranscriptPosition,
} from '@/features/chat/state/history/transcript';
import type { PersistedChatMessage } from '@/features/chat/state/types';

function message(
  id: string,
  role: PersistedChatMessage['role'],
  content: string,
  delivery_state?: PersistedChatMessage['delivery_state'],
): PersistedChatMessage {
  return {
    id,
    role,
    content,
    created_at: '2026-09-21T12:00:00Z',
    delivery_state,
  };
}

describe('history transcript normalization', () => {
  it('parses tool rows and rejects non-tool or malformed rows', () => {
    expect(parseToolHistoryEvent(message('1', 'tool', '{"kind":"tool_call"}')))
      .toEqual({ kind: 'tool_call' });
    expect(parseToolHistoryEvent(message('2', 'agent', '{"kind":"tool_call"}')))
      .toBeNull();
    expect(parseToolHistoryEvent(message('3', 'tool', '{bad'))).toBeNull();
  });

  it('normalizes tool results and lets the latest persisted result win', () => {
    const results = collectToolResults([
      message('1', 'tool', JSON.stringify({
        kind: 'tool_result', tool_use_id: 'read-1', result: 42,
      })),
      message('2', 'tool', JSON.stringify({
        kind: 'tool_result', tool_use_id: 'read-1', result: 'denied', is_error: true,
      })),
      message('3', 'tool', JSON.stringify({ kind: 'tool_result' })),
    ]);

    expect([...results]).toEqual([['read-1', { isError: true, result: 'denied' }]]);
  });

  it('tracks delivered turns while leaving queued rows outside the transcript', () => {
    const position = new TranscriptPosition();
    position.observe(message('agent', 'agent', 'hello'));
    expect(position).toMatchObject({
      currentTurnId: 'turn-agent-0', assistantMessageCount: 1, transcriptIndex: 1,
    });

    position.observe(message('queued', 'user', 'later', 'queued'));
    expect(position.currentTurnId).toBe('turn-agent-0');
    position.observe(message('steered', 'user', 'change', 'steered'));
    expect(position).toMatchObject({
      currentTurnId: 'turn-1', assistantMessageCount: 0, transcriptIndex: 2,
    });
  });

  it('treats an optimistic queued row as a turn and finds earlier stale runs', () => {
    const messages = [
      message('first', 'user', 'start'),
      message('tool', 'tool', '{}'),
      message('queued', 'user', 'continue', 'queued'),
    ];
    expect(indexesBeforeLaterUser(messages)).toEqual(new Set([0]));
    expect(indexesBeforeLaterUser(messages, new Set(['queued'])))
      .toEqual(new Set([0, 1, 2]));

    const position = new TranscriptPosition();
    position.observe(messages[2], new Set(['queued']));
    expect(position.currentTurnId).toBe('turn-0');
  });
});
