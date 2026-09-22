import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { touchesLeanFile, TurnLivenessTracker } from '@main/services/sessions/session/event-state';

describe('TurnLivenessTracker', () => {
  const started = (id: string, parent: string | null = null): AgentEvent => ({
    kind: 'tool_call_started',
    turnId: 't',
    toolCallId: id,
    tool: 'Read',
    input: {},
    parentToolCallId: parent,
    at: 1,
  });
  const completed = (id: string): AgentEvent => ({
    kind: 'tool_call_completed',
    turnId: 't',
    toolCallId: id,
    result: null,
    isError: false,
    at: 1,
  });

  it('opens only while a top-level call is outstanding', () => {
    const tracker = new TurnLivenessTracker();
    expect(tracker.turnIsLive).toBe(false);
    tracker.observe(started('a'), true);
    expect(tracker.turnIsLive).toBe(true);
    tracker.observe(completed('a'), true);
    expect(tracker.turnIsLive).toBe(false);
  });

  it('closes on the first result of a parallel batch', () => {
    const tracker = new TurnLivenessTracker();
    tracker.observe(started('a'), true);
    tracker.observe(started('b'), true);
    tracker.observe(completed('a'), true);
    expect(tracker.turnIsLive).toBe(false);
  });

  it('ignores subagent calls and results', () => {
    const tracker = new TurnLivenessTracker();
    tracker.observe(started('child', 'task'), false);
    expect(tracker.turnIsLive).toBe(false);
    tracker.observe(started('top'), true);
    tracker.observe(completed('child'), false);
    expect(tracker.turnIsLive).toBe(true);
  });
});

describe('touchesLeanFile', () => {
  it('recognises Lean writes by every provider spelling', () => {
    expect(touchesLeanFile('Write', { file_path: 'Sample/Basic.lean' })).toBe(true);
    expect(touchesLeanFile('Edit', { file_path: 'blueprint/src/content.tex' })).toBe(false);
    expect(touchesLeanFile('Read', { file_path: 'Sample/Basic.lean' })).toBe(false);
    expect(touchesLeanFile('FileChange', { changes: [{ path: 'Sample/Basic.lean', kind: 'update' }] })).toBe(true);
  });
});
