import { describe, expect, it } from 'vitest';

import { createInitialChatState } from '@/features/chat/state/message-state';
import { createSubagentEventState } from '@/features/chat/state/subagent-event-state';
import type { ChatState } from '@/features/chat/state/types';

const event = (data: unknown, lastEventId = ''): Event => ({
  data: JSON.stringify(data), lastEventId,
}) as unknown as Event;

function setup() {
  const state = createInitialChatState();
  let order = 0;
  const rememberedEventIds = new Set<string>();
  const controller = createSubagentEventState({
    state,
    nextActivityOrder: () => ++order,
    currentTurnContext: () => ({ turnId: 'turn-0', assistantMessageCount: 2 }),
    rememberEvent: (eventId) => {
      if (!eventId) return true;
      if (rememberedEventIds.has(eventId)) return false;
      rememberedEventIds.add(eventId);
      return true;
    },
    appliedMessageIds: new Set(),
  });
  return { state, controller, getOrder: () => order };
}

function firstSubagent(state: ChatState) {
  const subagent = state.subagents[0];
  expect(subagent).toBeDefined();
  return subagent;
}

describe('subagent event state', () => {
  it('streams text then replaces it with the durable message', () => {
    const { state, controller } = setup();
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: 'partial', delta_kind: 'text',
    }, '1'));
    controller.handleMessage(event({
      parent_tool_use_id: 'agent-1', text: 'final', message_id: 'message-1',
    }, '2'));
    expect(state.subagents[0]).toMatchObject({
      parentToolUseId: 'agent-1',
      text: 'final',
      messages: [{ text: 'final', messageId: 'message-1' }],
    });
  });

  it('patches late spawn metadata without changing chronology', () => {
    const { state, controller, getOrder } = setup();
    const placeholder = controller.ensure('agent-1');
    const originalArray = state.subagents;
    const patched = controller.ensure(
      'agent-1', 'Researcher', 'sonnet', 'turn-1', 3, 99, 'Pass 1',
    );

    expect(placeholder).toMatchObject({
      description: 'subagent', order: 1, anchorAfterMessageCount: -1,
    });
    expect(patched).toMatchObject({
      description: 'Researcher', model: 'sonnet', anchorTurnId: 'turn-1',
      anchorAfterMessageCount: 3, passLabel: 'Pass 1', order: 1,
    });
    expect(state.subagents).not.toBe(originalArray);
    expect(getOrder()).toBe(1);
  });

  it('concatenates text deltas in one timeline position and dedupes events', () => {
    const { state, controller } = setup();
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: 'one', delta_kind: 'text',
    }, 'delta-1'));
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: ' two', delta_kind: 'text',
    }, 'delta-2'));
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: ' duplicate', delta_kind: 'text',
    }, 'delta-2'));
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: ' hidden', delta_kind: 'thinking',
    }, 'delta-3'));

    expect(firstSubagent(state)).toMatchObject({
      anchorTurnId: 'turn-0',
      anchorAfterMessageCount: 2,
      text: 'one two',
      messages: [{ text: 'one two', order: 2, streaming: true }],
    });
  });

  it('drops a replayed live buffer when its durable message already exists', () => {
    const { state, controller } = setup();
    controller.handleMessage(event({
      parent_tool_use_id: 'agent-1', text: 'first', message_id: 'message-1',
    }, 'message-event-1'));
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: 'first replay', delta_kind: 'text',
    }, 'delta-1'));
    controller.handleMessage(event({
      parent_tool_use_id: 'agent-1', text: 'first', message_id: 'message-1',
    }, 'message-event-2'));

    expect(firstSubagent(state)).toMatchObject({
      text: 'first',
      messages: [{ text: 'first', order: 2, messageId: 'message-1' }],
    });
  });

  it('preserves streamed order on final text and orders later text after it', () => {
    const { state, controller } = setup();
    controller.handleStreamDelta(event({
      parent_tool_use_id: 'agent-1', text: 'draft', delta_kind: 'text',
    }, 'delta-1'));
    controller.handleText(event({ parent_tool_use_id: 'agent-1', text: 'final' }));
    controller.handleText(event({ parent_tool_use_id: 'agent-1', text: 'follow-up' }));

    expect(firstSubagent(state)).toMatchObject({
      text: 'follow-up',
      messages: [
        { text: 'final', order: 2 },
        { text: 'follow-up', order: 3 },
      ],
    });
  });
});
