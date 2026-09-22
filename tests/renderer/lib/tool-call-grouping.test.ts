import { describe, expect, it } from 'vitest';

import type { ActivityItem } from '@/features/chat/state/types';
import { activityDisplayKey, coalesceActivityCalls, extractSearchQuery } from '@/lib/tool-call-grouping';

function call(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return { tool: 'blueprint-tools', summary: 'update_declaration', ...overrides } as ActivityItem;
}

describe('tool call grouping', () => {
  it('uses the query shape rendered by search rows', () => {
    expect(extractSearchQuery({ query: 'foo', name: 'bar' })).toBe('foo');
    expect(extractSearchQuery({ declaration_name: 'Nat.add' })).toBe('Nat.add');
  });

  it('keys generic, raw-input, and search calls by their visual identity', () => {
    expect(activityDisplayKey(call({ rawInput: { name: 'A' } })))
      .toBe(activityDisplayKey(call({ rawInput: { name: 'B' } })));
    expect(activityDisplayKey(call({ tool: 'Read', rawInput: { file_path: 'A.lean' } })))
      .not.toBe(activityDisplayKey(call({ tool: 'Read', rawInput: { file_path: 'B.lean' } })));
    expect(activityDisplayKey(call({ tool: 'lean-explore', rawInput: { query: 'A' } })))
      .not.toBe(activityDisplayKey(call({ tool: 'lean-explore', rawInput: { query: 'B' } })));
  });

  it('coalesces only consecutive matching rows and preserves stable ids', () => {
    const groups = coalesceActivityCalls([
      call({ toolUseId: 'first' }), call({}),
      call({ tool: 'Read', rawInput: { file_path: 'A' } }),
      call({}),
    ]);
    expect(groups.map(({ count }) => count)).toEqual([2, 1, 1]);
    expect(groups[0].key).toBe('first');
  });
});
