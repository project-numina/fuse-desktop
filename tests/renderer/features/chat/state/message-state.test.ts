import { describe, expect, it } from 'vitest';

import {
  buildChatMessages,
  buildChatSnapshot,
  collectPersistedAssistantTurnIds,
  collectOptimisticTurnMessageIds,
  contextAttachmentPayload,
  createInitialChatState,
  currentTurnContext,
  findLastPendingStreamMessage,
  findLastStreamingMessage,
  mergePendingLocalMessages,
  updateUserMessageDeliveryState,
} from '@/features/chat/state/message-state';
import type { ChatMessage, PersistedChatMessage } from '@/features/chat/state/types';

describe('chat message state', () => {
  it('creates independent initial collection state', () => {
    const first = createInitialChatState();
    const second = createInitialChatState();
    first.messages.push({ role: 'user', text: 'hello' });
    expect(second.messages).toEqual([]);
    expect(first.liveSession.canSend).toBe(true);
  });

  it('copies only the mutable collections when building a snapshot', () => {
    const state = createInitialChatState();
    state.messages.push({ role: 'user', text: 'hello' });
    state.buildHistory.push({ title: 'Build', status: 'running', turnId: null, steps: [] });
    const snapshot = buildChatSnapshot(state);

    expect(snapshot).toEqual(state);
    expect(snapshot.messages).not.toBe(state.messages);
    expect(snapshot.buildHistory).not.toBe(state.buildHistory);
    expect(snapshot.activities).toBe(state.activities);
    expect(snapshot.liveSession).toBe(state.liveSession);
  });

  it('normalizes attachment payload defaults without mutating display metadata', () => {
    expect(contextAttachmentPayload([])).toEqual({});
    expect(contextAttachmentPayload([{
      attachment_kind: 'repo_file',
      repo_path: 'Main.lean',
      display_name: 'Main',
    }])).toEqual({ context_attachments: [{
      attachment_kind: 'repo_file',
      source_id: null,
      artifact_kind: null,
      repo_path: 'Main.lean',
      selection: { kind: 'entire_file' },
    }] });
  });

  it('maps persisted user metadata and extracts agent suggestions', () => {
    const suggestions: string[] = [];
    const persisted = [
      {
        id: 'user-1', role: 'user', content: 'go', created_at: '',
        delivery_state: 'delivered',
      },
      {
        id: 'agent-1', role: 'agent', content: 'Done <suggest>Next</suggest>', created_at: '',
      },
    ] satisfies PersistedChatMessage[];
    expect(buildChatMessages(persisted, (value) => suggestions.push(value))).toEqual([
      { role: 'user', text: 'go', messageId: 'user-1', deliveryState: 'delivered' },
      { role: 'agent', text: 'Done' },
    ]);
    expect(suggestions).toEqual(['Next']);
  });

  it('skips tool rows and invalid persisted delivery states', () => {
    const persisted = [
      {
        id: 'tool-1', role: 'tool', content: '{}', created_at: '',
      },
      {
        id: 'user-1', role: 'user', content: 'go', created_at: '',
        delivery_state: 'unknown',
      },
    ] as PersistedChatMessage[];

    expect(buildChatMessages(persisted, () => undefined)).toEqual([
      { role: 'user', text: 'go', messageId: 'user-1' },
    ]);
  });

  it('collects stable assistant turn ids around skipped transcript rows', () => {
    const persisted = [
      persistedMessage('queued', 'user', { delivery_state: 'queued' }),
      persistedMessage('first', 'agent'),
      persistedMessage('tool', 'tool'),
      persistedMessage('user', 'user'),
      persistedMessage('second', 'agent'),
      persistedMessage('third', 'agent'),
    ];

    expect(collectPersistedAssistantTurnIds(persisted, new Set())).toEqual([
      'turn-agent-0:assistant-0',
      'turn-1:assistant-0',
      'turn-1:assistant-1',
    ]);
    expect(collectPersistedAssistantTurnIds(persisted, new Set(['queued']))).toEqual([
      'turn-0:assistant-0',
      'turn-2:assistant-0',
      'turn-2:assistant-1',
    ]);
  });

  it('preserves a newer local delivery state and optimistic tail', () => {
    const persisted: ChatMessage[] = [
      { role: 'user', text: 'go', messageId: 'user-1', deliveryState: 'queued' },
    ];
    const local: ChatMessage[] = [
      { role: 'user', text: 'go', messageId: 'user-1', deliveryState: 'steered' },
      { role: 'user', text: 'later', messageId: 'user-2', optimisticTurn: true },
    ];
    expect(mergePendingLocalMessages(persisted, local)).toEqual([
      { role: 'user', text: 'go', messageId: 'user-1', deliveryState: 'steered' },
      local[1],
    ]);
    expect(collectOptimisticTurnMessageIds(local)).toEqual(new Set(['user-2']));
  });

  it('drops a local tail when its display prefix no longer matches history', () => {
    const persisted: ChatMessage[] = [{ role: 'user', text: 'server' }];
    const local: ChatMessage[] = [
      { role: 'user', text: 'local' },
      { role: 'agent', text: 'tail' },
    ];

    expect(mergePendingLocalMessages(persisted, local)).toEqual(persisted);
  });

  it('finds the latest matching active and pending stream messages', () => {
    const first: ChatMessage = {
      role: 'agent', text: 'first', assistantTurnId: 'turn-1',
      streaming: true, fromStream: true,
    };
    const finalized: ChatMessage = {
      role: 'agent', text: 'final', assistantTurnId: 'turn-2',
      streaming: true, fromStream: true, finalized: true,
    };
    const latest: ChatMessage = {
      role: 'agent', text: 'latest', assistantTurnId: 'turn-3',
      streaming: true, fromStream: true, finalized: false,
    };
    const messages = [first, finalized, latest];

    expect(findLastStreamingMessage(messages)).toBe(latest);
    expect(findLastStreamingMessage(messages, 'turn-1')).toBe(first);
    expect(findLastPendingStreamMessage(messages)).toBe(latest);
    expect(findLastPendingStreamMessage(messages, 'turn-2')).toBeUndefined();
  });

  it('groups turns while ignoring retained queued rows and placeholders', () => {
    expect(currentTurnContext([
      { role: 'user', text: 'queued', deliveryState: 'queued' },
      { role: 'user', text: 'go' },
      { role: 'agent', text: '', placeholder: true },
      { role: 'agent', text: 'answer' },
    ])).toEqual({ turnId: 'turn-0', assistantMessageCount: 1 });
  });

  it('moves a newly delivered queued row behind content that arrived first', () => {
    const message: ChatMessage = {
      role: 'user', text: 'queued', deliveryState: 'queued',
    };
    const messages: ChatMessage[] = [message, { role: 'agent', text: 'answer' }];
    updateUserMessageDeliveryState(messages, message, 'delivered');
    expect(messages.map(({ text }) => text)).toEqual(['answer', 'queued']);
  });

  it('keeps optimistic and superseded queued rows in place', () => {
    const optimistic: ChatMessage = {
      role: 'user', text: 'optimistic', deliveryState: 'queued', optimisticTurn: true,
    };
    const superseded: ChatMessage = {
      role: 'user', text: 'superseded', deliveryState: 'queued',
    };
    const answer: ChatMessage = { role: 'agent', text: 'answer' };
    const messages = [optimistic, superseded, answer];

    updateUserMessageDeliveryState(messages, optimistic, 'delivered');
    updateUserMessageDeliveryState(messages, superseded, 'superseded');

    expect(messages).toEqual([optimistic, superseded, answer]);
    expect(optimistic.optimisticTurn).toBeUndefined();
  });
});

function persistedMessage(
  id: string,
  role: PersistedChatMessage['role'],
  extra: Partial<PersistedChatMessage> = {},
): PersistedChatMessage {
  return { id, role, content: id, created_at: '', ...extra };
}
