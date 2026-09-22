import { describe, expect, it } from 'vitest';

import type {
  ActivityItem,
  SubagentStream,
} from '@/features/chat/state/types';
import { buildSubagentPreview } from '@/features/chat/components/subagents/subagent-card-preview';

function call(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return { tool: 'Read', summary: 'A', ...overrides };
}

function child(overrides: Partial<SubagentStream> = {}): SubagentStream {
  return {
    parentToolUseId: 'child-1',
    parentSubagentId: 'parent-1',
    anchorTurnId: 'turn-1',
    anchorAfterMessageCount: 0,
    description: 'Reviewer',
    model: null,
    text: '',
    status: 'running',
    toolCalls: [],
    ...overrides,
  };
}

describe('buildSubagentPreview', () => {
  it('keeps matching call runs separate across a child boundary', () => {
    const preview = buildSubagentPreview(
      [
        call({ toolUseId: 'call-1', order: 1 }),
        call({ toolUseId: 'call-2', order: 2 }),
        call({ toolUseId: 'call-4', order: 4 }),
        call({ toolUseId: 'call-5', order: 5 }),
      ],
      [child({ order: 3 })],
    );

    expect(preview.entries.map((entry) => (
      entry.kind === 'call' ? entry.group.count : entry.label
    ))).toEqual([2, 'Agent Reviewer', 2]);
    expect(preview.entries.map((entry) => entry.key)).toEqual([
      'call-1',
      'child-child-1',
      'call-4',
    ]);
  });

  it('drops the oldest entries after ordering and hides invisible calls', () => {
    const preview = buildSubagentPreview(
      [
        call({ summary: 'old', order: 1 }),
        call({ summary: 'hidden', hidden: true, order: 5 }),
        call({ summary: 'B', order: 3 }),
        call({ summary: 'C', order: 4 }),
      ],
      [child({ order: 2 })],
    );

    expect(preview.visibleCount).toBe(3);
    expect(preview.entries.map((entry) => (
      entry.kind === 'call' ? entry.group.activity.summary : entry.label
    ))).toEqual(['Agent Reviewer', 'B', 'C']);
  });

  it('counts calls without letting hidden preview kinds evict children', () => {
    const preview = buildSubagentPreview(
      [
        call({ order: 2 }),
        call({ summary: 'B', order: 3 }),
        call({ summary: 'C', order: 4 }),
      ],
      [child({ order: 1 })],
      { includeCalls: false },
    );

    expect(preview.visibleCount).toBe(3);
    expect(preview.entries).toEqual([
      expect.objectContaining({ kind: 'child', label: 'Agent Reviewer' }),
    ]);
  });
});
