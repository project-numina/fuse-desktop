import { describe, expect, it } from 'vitest';

import {
  buildIterationOptions,
  buildTimeline,
  buildTimelineBlocks,
  fallbackMessageOrder,
  pairChildLaunchers,
  selectReadableRuns,
  visibleActivityCalls,
} from '@/features/chat/components/subagents/subagent-expanded-timeline';
import type { ActivityItem, SubagentStream } from '@/features/chat/state/types';

function agent(overrides: Partial<SubagentStream> = {}): SubagentStream {
  return {
    parentToolUseId: 'run-1',
    anchorTurnId: 'turn-1',
    anchorAfterMessageCount: 0,
    description: 'Formalizer',
    model: 'Claude',
    text: '',
    status: 'done',
    toolCalls: [],
    ...overrides,
  };
}

describe('subagent expanded timeline derivation', () => {
  it('offers readable and active runs while retaining all-empty exchanges', () => {
    const empty = agent({ parentToolUseId: 'empty', status: 'failed' });
    const active = agent({ parentToolUseId: 'active', status: 'running' });
    const childOwner = agent({ parentToolUseId: 'parent' });
    const child = agent({ parentToolUseId: 'child', parentSubagentId: 'parent' });

    expect(selectReadableRuns([empty, active, childOwner], [child])).toEqual([
      active,
      childOwner,
    ]);
    expect(selectReadableRuns([empty, childOwner], [])).toEqual([empty, childOwner]);
  });

  it('numbers writer and reviewer turns independently', () => {
    const runs = [
      agent({ parentToolUseId: 'writer-1' }),
      agent({ parentToolUseId: 'review-1', description: 'Formalizer-reviewer' }),
      agent({ parentToolUseId: 'writer-2' }),
    ];

    expect(buildIterationOptions(runs)).toEqual([
      { value: 'writer-1', label: 'Formalizer 1' },
      { value: 'review-1', label: 'Reviewer 1' },
      { value: 'writer-2', label: 'Formalizer 2' },
    ]);
  });

  it('pairs batch children once and leaves hidden or represented calls out', () => {
    const calls: ActivityItem[] = [
      { tool: 'prover-tools', summary: 'run_provers', toolUseId: 'launch-1', order: 1 },
      { tool: 'prover-tools', summary: 'run_provers', toolUseId: 'launch-2', order: 4 },
      { tool: 'Read', summary: 'hidden', hidden: true, order: 5 },
      { tool: 'Bash', summary: 'lake build', order: 6 },
    ];
    const children = [
      agent({
        parentToolUseId: 'worker-1',
        synthetic: 'prover',
        batchId: 'batch-1',
        order: 2,
      }),
      agent({
        parentToolUseId: 'worker-2',
        synthetic: 'prover',
        batchId: 'batch-2',
        order: 5,
      }),
    ];

    const pairs = pairChildLaunchers(calls, children);
    expect(pairs.get('worker-1')?.toolUseId).toBe('launch-1');
    expect(pairs.get('worker-2')?.toolUseId).toBe('launch-2');
    expect(visibleActivityCalls(calls, pairs)).toEqual([
      { tool: 'Bash', summary: 'lake build', order: 6 },
    ]);
  });

  it('orders messages, coalesced calls, and grouped children into blocks', () => {
    const calls: ActivityItem[] = [
      { tool: 'Read', summary: 'A.lean', order: 2 },
      { tool: 'Read', summary: 'A.lean', order: 3 },
    ];
    const run = agent({
      messages: [{ text: 'Inspecting.', order: 1 }],
      toolCalls: calls,
    });
    const children = [
      agent({ parentToolUseId: 'child-1', batchId: 'batch', order: 4 }),
      agent({ parentToolUseId: 'child-2', batchId: 'batch', order: 5 }),
    ];
    const launchers = pairChildLaunchers(calls, children);
    const timeline = buildTimeline(
      calls,
      [run],
      children,
      launchers,
      fallbackMessageOrder(calls, children),
    );

    expect(timeline.map((entry) => entry.kind)).toEqual(['message', 'call', 'subagents']);
    expect(timeline[1]).toMatchObject({ kind: 'call', group: { count: 2 } });
    expect(timeline[2]).toMatchObject({ kind: 'subagents', subagents: children });
    expect(buildTimelineBlocks(timeline)).toHaveLength(1);
  });
});
