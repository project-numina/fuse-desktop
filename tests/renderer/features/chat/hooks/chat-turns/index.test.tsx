import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChatTurns, type ChatTurnsState } from '@/features/chat/hooks/chat-turns';
import type { ActivityItem, SubagentStream } from '@/features/chat/state/types';

const state = (overrides: Partial<ChatTurnsState> = {}): ChatTurnsState => ({ messages: [], activities: [], subagents: [], sending: false, ...overrides });
const activity = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({ tool: 'Read', summary: 'Foo.lean', ...overrides });
const subagent = (id: string, order: number, overrides: Partial<SubagentStream> = {}): SubagentStream => ({
  parentToolUseId: id, anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, description: id,
  model: null, text: '', toolCalls: [], status: 'running', order, ...overrides,
});

describe('useChatTurns', () => {
  it('groups user and assistant messages while preserving agent-only turns', () => {
    const { result } = renderHook(() => useChatTurns(state({ messages: [
      { role: 'agent', text: 'preface' }, { role: 'user', text: 'hello' },
      { role: 'agent', text: 'hi', isError: true }, { role: 'user', text: 'again' },
    ] })));
    expect(result.current.turns.map((turn) => turn.id)).toEqual(['turn-agent-0', 'turn-1', 'turn-3']);
    expect(result.current.turns[1].assistantBlocks[0]).toMatchObject({ text: 'hi', isError: true });
  });

  it('donates placeholder activities without advancing message ordinals', () => {
    const frozen = activity();
    const { result } = renderHook(() => useChatTurns(state({ messages: [
      { role: 'user', text: 'go' }, { role: 'agent', text: '', placeholder: true, activities: [frozen] }, { role: 'agent', text: 'done' },
      { role: 'user', text: 'again' },
    ] })));
    expect(result.current.turns.map((turn) => turn.id)).toEqual(['turn-0', 'turn-2']);
    expect(result.current.turns[0].assistantBlocks).toHaveLength(1);
    expect(result.current.turns[0].frozenActivities).toEqual([frozen]);
  });

  it('derives activity turn and rendered assistant states', () => {
    const { result } = renderHook(() => useChatTurns(state({ sending: true, messages: [
      { role: 'user', text: 'one' }, { role: 'agent', text: 'stream', streaming: true }, { role: 'user', text: 'two' },
    ] })));
    expect(result.current.activityTurnId).toBe('turn-0');
    expect(result.current.renderedTurns[0]).toMatchObject({ assistantPresent: true, assistantStreaming: true, assistantState: 'complete' });
    expect(result.current.renderedTurns[0].assistantRenderedBlocks[0].state).toBe('streaming');
    expect(result.current.renderedTurns[1].assistantState).toBe('none');
  });

  it('shows typing only on the active turn with no stream', () => {
    const { result } = renderHook(() => useChatTurns(state({ sending: true, messages: [{ role: 'user', text: 'go' }] })));
    expect(result.current.renderedTurns[0].assistantState).toBe('typing');
  });

  it('renders an idle follow-up as a turn during backend acceptance', () => {
    const { result } = renderHook(() => useChatTurns(state({ messages: [
      { role: 'user', text: 'first' },
      { role: 'agent', text: 'answer' },
      {
        role: 'user',
        text: 'next',
        deliveryState: 'queued',
        optimisticTurn: true,
      },
    ] })));

    expect(result.current.pendingUserMessages).toEqual([]);
    expect(result.current.turns.at(-1)).toMatchObject({
      userText: 'next',
      userDeliveryState: 'queued',
    });
  });

  it('coalesces only adjacent display-identical activities', () => {
    const entries = [
      activity({ tool: 'Grep', summary: 'x', rawInput: { pattern: 'x' }, anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, order: 1 }),
      activity({ tool: 'Grep', summary: 'x', rawInput: { pattern: 'x' }, anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, order: 2 }),
      activity({ tool: 'Grep', summary: 'y', rawInput: { pattern: 'y' }, anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, order: 3 }),
    ];
    const { result } = renderHook(() => useChatTurns(state({ messages: [{ role: 'user', text: 'go' }], activities: entries })));
    expect(result.current.bucketEntries('turn-0', 0, [])).toMatchObject([{ kind: 'activity', count: 2 }, { kind: 'activity', count: 1 }]);
  });

  it('interleaves activity and grouped subagents chronologically', () => {
    const { result } = renderHook(() => useChatTurns(state({
      messages: [{ role: 'user', text: 'go' }],
      activities: [activity({ anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, order: 2 })],
      subagents: [subagent('a', 1), subagent('b', 3), subagent('c', 4)],
    })));
    expect(result.current.bucketEntries('turn-0', 0, []).map((entry) => entry.kind)).toEqual(['subagents', 'activity', 'subagents']);
    expect(result.current.bucketEntries('turn-0', 0, [])[2]).toMatchObject({ subagents: [{ parentToolUseId: 'b' }, { parentToolUseId: 'c' }] });
  });

  it('renders one node per specialist rather than one card per pass', () => {
    const { result } = renderHook(() => useChatTurns(state({
      messages: [{ role: 'user', text: 'go' }],
      subagents: [
        subagent('draft', 1, {
          description: 'Blueprint writer', synthetic: 'authoring', batchId: 'draft-a',
        }),
        subagent('draft-review', 2, {
          description: 'Reviewer', synthetic: 'authoring', batchId: 'draft-a',
        }),
        subagent('w1', 3, {
          description: 'Formalizer', synthetic: 'authoring', batchId: 'formalize-a',
        }),
        subagent('r1', 4, {
          description: 'Reviewer', synthetic: 'authoring', batchId: 'formalize-a',
        }),
        subagent('w2', 5, {
          description: 'Formalizer', synthetic: 'authoring', batchId: 'formalize-a',
        }),
      ],
    })));

    const entries = result.current.bucketEntries('turn-0', 0, []);
    expect(entries.map((entry) => entry.kind)).toEqual(['specialist', 'specialist']);
    expect(entries[0]).toMatchObject({ group: { title: 'Blueprint writer' } });
    expect(entries[1]).toMatchObject({ group: { title: 'Formalizer' } });
    expect(
      entries[1].kind === 'specialist'
        ? entries[1].group.members.map((member) => member.parentToolUseId)
        : [],
    ).toEqual(['w1', 'r1', 'w2']);
  });

  it('fills the node a re-entered specialist already has, in its own turn', () => {
    const { result } = renderHook(() => useChatTurns(state({
      messages: [
        { role: 'user', text: 'formalize' },
        { role: 'agent', text: 'done' },
        { role: 'user', text: 'again' },
      ],
      subagents: [
        subagent('w1', 1, {
          description: 'Formalizer', synthetic: 'authoring', batchId: 'formalize-a',
        }),
        subagent('w2', 5, {
          description: 'Formalizer',
          synthetic: 'authoring',
          batchId: 'formalize-b',
          anchorTurnId: 'turn-2',
        }),
      ],
    })));

    const first = result.current.bucketEntries('turn-0', 0, []);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'specialist' });
    // The re-entry joins the node above instead of opening a second one, and
    // leaves the later turn with nothing of its own to draw.
    expect(result.current.bucketEntries('turn-2', 0, [])).toEqual([]);
    expect(result.current.subagentsForTurn('turn-2')).toEqual([]);
  });

  it('gives two formalizers on two files two nodes', () => {
    const { result } = renderHook(() => useChatTurns(state({
      messages: [{ role: 'user', text: 'formalize both files' }],
      subagents: [
        subagent('basic-w', 1, {
          description: 'Formalizer',
          synthetic: 'authoring',
          batchId: 'formalize-a',
          specialistTarget: 'lean/Project/Basic.lean',
        }),
        subagent('scales-w', 2, {
          description: 'Formalizer',
          synthetic: 'authoring',
          batchId: 'formalize-b',
          specialistTarget: 'lean/Project/Scales.lean',
        }),
        subagent('basic-r', 3, {
          description: 'Reviewer',
          synthetic: 'authoring',
          batchId: 'formalize-a',
          specialistTarget: 'lean/Project/Basic.lean',
        }),
      ],
    })));

    const entries = result.current.bucketEntries('turn-0', 0, []);
    expect(entries.map((entry) => entry.kind)).toEqual(['specialist', 'specialist']);
    expect(
      entries[0].kind === 'specialist'
        ? entries[0].group.members.map((member) => member.parentToolUseId)
        : [],
    ).toEqual(['basic-w', 'basic-r']);
  });

  it('keeps prover batches grouped by batch id, not by specialist', () => {
    const { result } = renderHook(() => useChatTurns(state({
      messages: [{ role: 'user', text: 'go' }],
      subagents: [
        subagent('a1', 1, { synthetic: 'prover', batchId: 'batch-a' }),
        subagent('a2', 2, { synthetic: 'prover', batchId: 'batch-a' }),
        subagent('b1', 3, { synthetic: 'prover', batchId: 'batch-b' }),
        subagent('b2', 4, { synthetic: 'prover', batchId: 'batch-b' }),
      ],
    })));

    const entries = result.current.bucketEntries('turn-0', 0, []);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      subagents: [
        { parentToolUseId: 'a1' },
        { parentToolUseId: 'a2' },
      ],
    });
    expect(entries[1]).toMatchObject({
      subagents: [
        { parentToolUseId: 'b1' },
        { parentToolUseId: 'b2' },
      ],
    });
  });

  it('keeps explore cards standalone and excludes nested children', () => {
    const { result } = renderHook(() => useChatTurns(state({ messages: [{ role: 'user', text: 'go' }], subagents: [
      subagent('a', 1), subagent('explore', 2, { synthetic: 'explore' }), subagent('child', 3, { parentSubagentId: 'a' }),
    ] })));
    expect(result.current.bucketEntries('turn-0', 0, [])).toHaveLength(2);
    expect(result.current.subagentsForTurn('turn-0').map((item) => item.parentToolUseId)).toEqual(['a', 'explore']);
  });

  it('ignores hidden, Agent, child, and other-turn activities', () => {
    const { result } = renderHook(() => useChatTurns(state({ activities: [
      activity({ tool: 'Agent', anchorTurnId: 'turn-0' }), activity({ hidden: true, anchorTurnId: 'turn-0' }),
      activity({ parentToolUseId: 'a', anchorTurnId: 'turn-0' }), activity({ anchorTurnId: 'turn-1' }),
    ] })));
    expect(result.current.turnHasActivity('turn-0', [])).toBe(false);
    expect(result.current.turnHasActivity('turn-0', [activity({ anchorTurnId: 'turn-0' })])).toBe(true);
  });
});
