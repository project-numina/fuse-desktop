import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { ClaudeEventTranslator } from '@main/agents/claude-code/events';
import { ClaudePermissionController } from '@main/agents/claude-code/permissions';

describe('ClaudeEventTranslator', () => {
  it('deduplicates complete text across the stream and assistant lines', () => {
    const events: AgentEvent[] = [];
    const finishTurn = vi.fn();
    const onThreadStarted = vi.fn();
    const permissions = new ClaudePermissionController((event) => events.push(event), vi.fn());
    const translator = new ClaudeEventTranslator((event) => events.push(event), permissions, {
      currentTurnId: () => 'turn-1',
      onThreadStarted,
      finishTurn,
      interruptRequested: () => false,
      log: vi.fn(),
    });

    translator.handleLine({ type: 'system', subtype: 'init', session_id: 'session-1', model: 'model-1' });
    translator.handleLine({ type: 'stream_event', event: { type: 'message_start', message: { id: 'message-1' } } });
    translator.handleLine({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } });
    translator.handleLine({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } } });
    translator.handleLine({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    translator.handleLine({ type: 'assistant', message: { id: 'message-1', content: [{ type: 'text', text: 'hello' }] } });
    translator.handleLine({ type: 'result', subtype: 'success', is_error: false, usage: {} });

    expect(onThreadStarted).toHaveBeenCalledWith('session-1', 'model-1');
    expect(events.filter((event) => event.kind === 'assistant_text_completed')).toHaveLength(1);
    expect(finishTurn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'turn_completed', turnId: 'turn-1' }));
  });
});
