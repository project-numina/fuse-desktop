import { describe, expect, it, vi } from 'vitest';

import { createInitialChatState } from '@/features/chat/state/message-state';
import { createToolCallState } from '@/features/chat/state/tool-call-state';
import type { ChatState, SubagentStream } from '@/features/chat/state/types';

const event = (data: unknown): Event => ({
  data: JSON.stringify(data),
}) as unknown as Event;

const subagent = (overrides: Partial<SubagentStream> = {}): SubagentStream => ({
  parentToolUseId: 'agent-1',
  anchorTurnId: 'turn-0',
  anchorAfterMessageCount: 0,
  description: 'Agent',
  model: null,
  text: '',
  toolCalls: [],
  status: 'running',
  ...overrides,
});

function createHarness(state: ChatState = createInitialChatState()) {
  let turnId = 'turn-0';
  let assistantMessageCount = 1;
  let order = 0;
  const appliedToolUseIds = new Set<string>();
  const ensureSubagent = vi.fn((
    parentToolUseId: string,
    description?: string,
    model?: string | null,
    anchorTurnId?: string | null,
    anchorAfterMessageCount?: number,
    activityOrder?: number,
    passLabel?: string,
  ): SubagentStream => {
    const existing = state.subagents.find(
      (candidate) => candidate.parentToolUseId === parentToolUseId,
    );
    if (existing) return existing;
    const created = subagent({
      parentToolUseId,
      description: description ?? 'Agent',
      model: model ?? null,
      anchorTurnId: anchorTurnId ?? null,
      anchorAfterMessageCount: anchorAfterMessageCount ?? -1,
      order: activityOrder,
      ...(passLabel ? { passLabel } : {}),
    });
    state.subagents = [...state.subagents, created];
    return created;
  });
  const writeSubagent = vi.fn((next: SubagentStream): void => {
    const index = state.subagents.findIndex(
      (candidate) => candidate.parentToolUseId === next.parentToolUseId,
    );
    state.subagents = index < 0
      ? [...state.subagents, next]
      : state.subagents.map((candidate, candidateIndex) => (
          candidateIndex === index ? next : candidate
        ));
  });
  const scrollToLatest = vi.fn();
  const controller = createToolCallState({
    state,
    appliedToolUseIds,
    ensureSubagent,
    writeSubagent,
    currentTurnContext: () => ({ turnId, assistantMessageCount }),
    nextActivityOrder: () => ++order,
    scrollToLatest,
  });
  return {
    state,
    controller,
    appliedToolUseIds,
    ensureSubagent,
    writeSubagent,
    scrollToLatest,
    order: () => order,
    setTurn: (nextTurnId: string, nextAssistantMessageCount: number) => {
      turnId = nextTurnId;
      assistantMessageCount = nextAssistantMessageCount;
    },
  };
}

describe('tool call state', () => {
  it('adds a top-level call once and attaches its result', () => {
    const { state, controller } = createHarness();
    const call = { tool: 'Read', input: { file_path: 'Main.lean' }, tool_use_id: 'tool-1' };
    controller.handleCall(event(call));
    controller.handleCall(event(call));
    controller.handleResult(event({
      tool_use_id: 'tool-1', result: 'contents', is_error: false,
    }));
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      toolUseId: 'tool-1', result: 'contents', isError: false,
      anchorTurnId: 'turn-0', anchorAfterMessageCount: 1,
    });
  });

  it('does not consume order or scroll for hidden and replayed calls', () => {
    const harness = createHarness();
    harness.controller.handleCall(event({
      tool: 'Write', tool_use_id: 'background',
      input: { file_path: '/tmp/.claude/background-log.md' },
    }));
    const call = { tool: 'Read', tool_use_id: 'read-1', input: { file_path: 'Main.lean' } };
    harness.controller.handleCall(event(call));
    harness.controller.handleCall(event(call));

    expect(harness.state.activities).toHaveLength(1);
    expect(harness.order()).toBe(1);
    expect(harness.scrollToLatest).toHaveBeenCalledTimes(1);
    expect(harness.appliedToolUseIds.has('background')).toBe(false);
  });

  it('anchors a late synthetic spawn to its launcher and keeps spawn metadata', () => {
    const harness = createHarness();
    harness.controller.handleCall(event({
      tool: 'mcp__authoring-tools__formalize',
      tool_use_id: 'launcher-1',
      input: {},
    }));
    harness.setTurn('turn-later', 4);
    harness.controller.handleCall(event({
      tool: 'Agent',
      tool_use_id: 'writer-1',
      parent_tool_use_id: 'delegator-1',
      model: 'Writer',
      input: {
        description: 'Formalize Foo',
        synthetic_for: 'authoring',
        status: 'queued',
        pass_label: 'Pass 1',
        batch_id: 'batch-1',
        launcher_tool: 'authoring-tools',
        specialist_target: 'Foo.lean',
      },
    }));

    expect(harness.state.subagents).toHaveLength(1);
    expect(harness.state.subagents[0]).toMatchObject({
      parentToolUseId: 'writer-1',
      parentSubagentId: 'delegator-1',
      anchorTurnId: 'turn-0',
      anchorAfterMessageCount: 1,
      order: 2,
      synthetic: 'authoring',
      status: 'queued',
      passLabel: 'Pass 1',
      batchId: 'batch-1',
      launcherTool: 'authoring-tools',
      specialistTarget: 'Foo.lean',
    });
    expect(harness.state.activities.map((activity) => activity.order)).toEqual([1, 2]);
  });

  it('does not roll an existing child back to queued when its spawn arrives late', () => {
    const state = createInitialChatState();
    state.subagents = [subagent({ parentToolUseId: 'agent-1', status: 'done' })];
    const harness = createHarness(state);
    harness.controller.handleCall(event({
      tool: 'Agent',
      tool_use_id: 'agent-1',
      input: {
        description: 'Formalize Foo',
        synthetic_for: 'delegated-multistep',
        status: 'queued',
      },
    }));

    expect(harness.state.subagents[0]).toMatchObject({
      parentToolUseId: 'agent-1', status: 'done', synthetic: 'delegated-multistep',
    });
  });

  it('drops dangling child prose and mirrors results into both activity logs', () => {
    const state = createInitialChatState();
    state.subagents = [subagent({
      messages: [
        { text: 'Confirmed', order: 1 },
        { text: 'Unconfirmed', order: 2, streaming: true },
      ],
      text: 'Confirmed\n\nUnconfirmed',
    })];
    const harness = createHarness(state);
    harness.controller.handleCall(event({
      tool: 'Read',
      tool_use_id: 'read-1',
      parent_tool_use_id: 'agent-1',
      input: { file_path: 'Main.lean' },
    }));
    harness.controller.handleResult(event({
      tool_use_id: 'read-1', result: 'denied', is_error: true,
    }));

    expect(harness.state.subagents[0]).toMatchObject({
      messages: [{ text: 'Confirmed', order: 1 }],
      text: 'Confirmed',
      toolCalls: [{ toolUseId: 'read-1', result: 'denied', isError: true }],
    });
    expect(harness.state.activities[0]).toMatchObject({
      toolUseId: 'read-1', result: 'denied', isError: true,
    });
  });

  it('cascades terminal status while unknown targets preserve subagent identity', () => {
    const state = createInitialChatState();
    state.subagents = [
      subagent({ parentToolUseId: 'parent' }),
      subagent({ parentToolUseId: 'child', parentSubagentId: 'parent' }),
    ];
    const harness = createHarness(state);
    harness.controller.handleAgentStatus(event({
      agent: 'Delegate', status: 'stopped', tool_use_id: 'parent',
    }));
    expect(harness.state.subagents.map(({ status }) => status)).toEqual([
      'cancelled', 'cancelled',
    ]);

    const settled = harness.state.subagents;
    harness.controller.handleAgentStatus(event({
      agent: 'ghost', status: 'failed', tool_use_id: 'missing',
    }));
    expect(harness.state.subagents).toBe(settled);
    expect(harness.state.activities.at(-1)).toMatchObject({
      tool: 'ghost', summary: 'failed', hidden: true,
    });
    expect(harness.scrollToLatest).toHaveBeenCalledTimes(2);
  });

  it('keeps sending gated by active work while updating prover batch progress', () => {
    const state = createInitialChatState();
    state.liveSession.activeWorkGroupCount = 1;
    state.liveSession.displayStatus = 'Delegated work is running.';
    const harness = createHarness(state);
    harness.controller.handleProverBatchStatus(event({
      batch_id: 'batch-1', active: true, completed: 2, total: 5, can_send: true,
    }));
    expect(harness.state.liveSession).toMatchObject({
      activeProverBatchId: 'batch-1',
      activeProverBatchCompleted: 2,
      activeProverBatchTotal: 5,
      canSend: false,
      displayStatus: 'Provers running (2/5).',
    });

    harness.state.liveSession.activeWorkGroupCount = 0;
    harness.controller.handleProverBatchStatus(event({ active: false, can_send: true }));
    expect(harness.state.liveSession).toMatchObject({
      activeProverBatchId: null,
      activeProverBatchCompleted: 0,
      activeProverBatchTotal: 0,
      canSend: true,
      displayStatus: 'Provers running (2/5).',
    });
  });
});
