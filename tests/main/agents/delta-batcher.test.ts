import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { DeltaBatcher } from '@main/agents/delta-batcher';

function delta(text: string, blockId = 'b1'): AgentEvent {
  return { kind: 'assistant_text_delta', turnId: 't', blockId, text, at: 1 };
}

describe('DeltaBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('merges consecutive deltas for one block and flushes on a timer', () => {
    const out: AgentEvent[] = [];
    const batcher = new DeltaBatcher((event) => out.push(event), 30);
    batcher.push(delta('Hel'));
    batcher.push(delta('lo'));
    batcher.push(delta(' x', 'b2'));
    expect(out).toEqual([]);
    vi.advanceTimersByTime(30);
    expect(out).toEqual([delta('Hello'), delta(' x', 'b2')]);
  });

  it('flushes pending deltas before any other event', () => {
    const out: AgentEvent[] = [];
    const batcher = new DeltaBatcher((event) => out.push(event), 30);
    batcher.push(delta('a'));
    const completed: AgentEvent = { kind: 'assistant_text_completed', turnId: 't', blockId: 'b1', text: 'a', at: 2 };
    batcher.push(completed);
    expect(out).toEqual([delta('a'), completed]);
    vi.advanceTimersByTime(30);
    expect(out).toHaveLength(2);
  });
});
