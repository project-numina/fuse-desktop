import { describe, expect, it, vi } from 'vitest';

import { createAssistantStreamState } from '@/features/chat/state/assistant-stream-state';
import { createInitialChatState } from '@/features/chat/state/message-state';
import type { ChatMessage } from '@/features/chat/state/types';

const event = (data: unknown): Event => ({
  data: JSON.stringify(data),
}) as unknown as Event;

function createHarness(options?: {
  messages?: ChatMessage[];
  appliedTurnIds?: string[];
  finalizedTurnIds?: string[];
}) {
  const state = createInitialChatState();
  state.messages = options?.messages ?? [];
  const appliedTurnIds = new Set(options?.appliedTurnIds);
  const finalizedTurnIds = new Set(options?.finalizedTurnIds);
  const freezeActivities = vi.fn();
  const emit = vi.fn();
  const scrollToLatest = vi.fn();
  const controller = createAssistantStreamState({
    state,
    appliedTurnIds,
    finalizedTurnIds,
    freezeActivities,
    emit,
    scrollToLatest,
  });
  return {
    state,
    appliedTurnIds,
    finalizedTurnIds,
    freezeActivities,
    emit,
    scrollToLatest,
    controller,
  };
}

describe('assistant stream state', () => {
  it('assembles deltas and finalizes the matching assistant turn', () => {
    const harness = createHarness();
    harness.controller.handleStart(event({ assistant_turn_id: 'turn-a' }));
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: 'Hel',
    }));
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: 'lo',
    }));
    harness.controller.handleChat(event({
      role: 'assistant', assistant_turn_id: 'turn-a', content: 'Hello!',
    }));

    expect(harness.state.messages).toEqual([expect.objectContaining({
      role: 'agent', text: 'Hello!', assistantTurnId: 'turn-a',
      streaming: false, finalized: true,
    })]);
    expect(harness.appliedTurnIds).toEqual(new Set(['turn-a']));
    expect(harness.finalizedTurnIds).toEqual(new Set(['turn-a']));
    expect(harness.freezeActivities).toHaveBeenCalledOnce();
    expect(harness.scrollToLatest).toHaveBeenCalledTimes(4);
  });

  it('keeps raw stream cursors while suggestion tags are split across deltas', () => {
    const harness = createHarness();
    harness.controller.handleStart(event({ assistant_turn_id: 'turn-a' }));
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: 'Answer <suggest>Next',
    }));
    expect(harness.state.messages[0].text).toBe('Answer');
    expect(harness.state.suggestion).toBeNull();

    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: ' step</suggest>',
    }));
    expect(harness.state.messages[0].text).toBe('Answer');
    expect(harness.state.suggestion).toBe('Next step');
  });

  it('resumes an applied turn from its visible text without adding a duplicate', () => {
    const message: ChatMessage = {
      role: 'agent', text: 'Existing', assistantTurnId: 'turn-a',
    };
    const harness = createHarness({
      messages: [message],
      appliedTurnIds: ['turn-a'],
    });

    harness.controller.handleStart(event({ assistant_turn_id: 'turn-a' }));
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: ' continuation',
    }));

    expect(harness.state.messages).toEqual([expect.objectContaining({
      text: 'Existing continuation',
      streaming: true,
      fromStream: true,
    })]);
    expect(harness.freezeActivities).not.toHaveBeenCalled();
  });

  it('ignores replayed lifecycle events after a turn is finalized', () => {
    const harness = createHarness();
    harness.controller.handleStart(event({ assistant_turn_id: 'turn-a' }));
    harness.controller.handleChat(event({
      role: 'agent', assistant_turn_id: 'turn-a', content: 'Final',
    }));
    const scrollCount = harness.scrollToLatest.mock.calls.length;

    harness.controller.handleStart(event({ assistant_turn_id: 'turn-a' }));
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: ' replayed',
    }));
    harness.controller.handleChat(event({
      role: 'agent', assistant_turn_id: 'turn-a', content: 'Wrong',
    }));

    expect(harness.state.messages).toHaveLength(1);
    expect(harness.state.messages[0].text).toBe('Final');
    expect(harness.scrollToLatest).toHaveBeenCalledTimes(scrollCount);
  });

  it('resets keyed and unkeyed raw cursors without changing visible rows', () => {
    const harness = createHarness();
    harness.controller.handleStart(event({ assistant_turn_id: 'turn-a' }));
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: 'Visible <suggest>hidden',
    }));
    harness.controller.resetStreamText();
    harness.controller.handleDelta(event({
      assistant_turn_id: 'turn-a', text: ' again',
    }));

    expect(harness.state.messages[0].text).toBe('Visible again');
    expect(harness.state.suggestion).toBeNull();

    harness.controller.handleStart(event({}));
    harness.controller.handleDelta(event({ text: 'Plain <suggest>hidden' }));
    harness.controller.resetStreamText();
    harness.controller.handleDelta(event({ text: ' tail' }));

    expect(harness.state.messages[1].text).toBe('Plain tail');
  });
});

describe('user-message delivery state', () => {
  it('adopts equal queued messages FIFO and preserves a buffered terminal update', () => {
    const first: ChatMessage = {
      role: 'user', text: 'Same', deliveryState: 'queued',
    };
    const second: ChatMessage = {
      role: 'user', text: 'Same', deliveryState: 'queued',
    };
    const harness = createHarness({ messages: [first, second] });
    harness.controller.handleDelivery(event({
      message_id: 'message-1', state: 'steered',
    }));
    harness.controller.handleChat(event({
      role: 'user', content: 'Same', message_id: 'message-1',
      delivery_state: 'queued',
    }));
    harness.controller.handleChat(event({
      role: 'user', content: 'Same', message_id: 'message-2',
      delivery_state: 'queued',
    }));

    expect(first).toMatchObject({
      messageId: 'message-1', deliveryState: 'steered',
    });
    expect(second).toMatchObject({
      messageId: 'message-2', deliveryState: 'queued',
    });
    expect(harness.emit).toHaveBeenCalledTimes(2);
  });

  it('moves a delivered queued row after content that arrived first', () => {
    const queued: ChatMessage = {
      role: 'user', text: 'Queued', deliveryState: 'queued',
    };
    const answer: ChatMessage = { role: 'agent', text: 'Answer' };
    const harness = createHarness({ messages: [queued, answer] });
    harness.controller.handleChat(event({
      role: 'user', content: 'Queued', message_id: 'message-1',
      delivery_state: 'queued',
    }));
    harness.controller.handleDelivery(event({
      message_id: 'message-1', state: 'delivered',
    }));

    expect(harness.state.messages).toEqual([answer, queued]);
    expect(queued.optimisticTurn).toBeUndefined();
  });

  it('does not roll back a terminal state when identity arrives again', () => {
    const message: ChatMessage = {
      role: 'user',
      text: 'Steer',
      messageId: 'message-1',
      deliveryState: 'steered',
    };
    const harness = createHarness({ messages: [message] });

    harness.controller.setUserMessageIdentity(message, 'message-1', 'queued');

    expect(message.deliveryState).toBe('steered');
  });

  it('clears buffered delivery updates on reset', () => {
    const message: ChatMessage = {
      role: 'user', text: 'Queued', deliveryState: 'queued',
    };
    const harness = createHarness({ messages: [message] });
    harness.controller.handleDelivery(event({
      message_id: 'message-1', state: 'steered',
    }));
    harness.controller.reset();
    harness.controller.handleChat(event({
      role: 'user', content: 'Queued', message_id: 'message-1',
      delivery_state: 'queued',
    }));

    expect(message.deliveryState).toBe('queued');
  });
});
