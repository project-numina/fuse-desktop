import { describe, expect, it } from 'vitest';
import { applySubagentStatus, applySubagentStatusCascade, applySubagentText, cancelActiveSubagents, createDisplayedChildSubagentsSelector, displayedChildSubagents, isSubagentSpawnTool, SUBAGENT_STATUS_BY_EVENT, SYNTHETIC_ANCHOR_TOOLS, syntheticSpawnFor } from '@/features/chat/state/subagents';
import type { SubagentStream } from '@/features/chat/state/types';

const subagent = (overrides: Partial<SubagentStream> = {}): SubagentStream => ({
  parentToolUseId: 'parent-1', anchorTurnId: 'turn-0', anchorAfterMessageCount: 0,
  description: 'subagent', model: null, text: '', toolCalls: [], status: 'running', ...overrides,
});

describe('subagent state helpers', () => {
  it('maps backend statuses and synthetic anchors', () => {
    expect(SUBAGENT_STATUS_BY_EVENT).toEqual({ running: 'running', proved: 'proved', completed: 'done', failed: 'failed', stopped: 'cancelled' });
    // Pinned exactly: a synthetic spawn whose `synthetic_for` is missing here
    // anchors nowhere, which renders as child activity with no card. That is
    // how the merger shipped without one.
    expect(SYNTHETIC_ANCHOR_TOOLS).toEqual({ prover: 'prover-tools', authoring: 'authoring-tools', explore: 'authoring-tools', merger: 'repo-git' });
  });
  it('recognizes both spawn names but only Agent as synthetic', () => {
    // `synthetic_for` is only ever set by backend code that publishes the spawn
    // as `Agent`, so `Task` opens a card without synthetic metadata.
    expect(['Agent', 'Task'].every(isSubagentSpawnTool)).toBe(true);
    expect(isSubagentSpawnTool('Read')).toBe(false);
    expect(isSubagentSpawnTool(null)).toBe(false);
    expect(syntheticSpawnFor('Agent', { synthetic_for: 'prover' })).toBe('prover');
    expect(syntheticSpawnFor('Task', { synthetic_for: 'prover' })).toBeNull();
    expect(syntheticSpawnFor('Agent', { synthetic_for: 7 })).toBeNull();
  });
  it.each([{ synthetic: 'prover' }, { model: 'Prover' }])('keeps a backend failure even when the prover claims PROVED', (identity) => {
    // The backend lifecycle event carries the verdict. A prover writing
    // "PROVED:" in its prose is making a claim and must not override it.
    const value = subagent({ ...identity, text: 'notes\n PROVED: Foo.bar' });
    applySubagentStatus(value, 'failed');
    expect(value.status).toBe('failed');
  });
  it('keeps real failures and applies ordinary statuses', () => {
    const value = subagent({ synthetic: 'prover', text: 'gave up' });
    applySubagentStatus(value, 'failed');
    expect(value.status).toBe('failed');
    applySubagentStatus(value, 'done');
    expect(value.status).toBe('done');
  });
  it('settles a live segment on a terminal status without dropping its prose', () => {
    const value = subagent({
      messages: [
        { text: 'Confirmed.', order: 1, messageId: 'message-1' },
        { text: 'Partial when the run died', order: 2, streaming: true },
      ],
    });
    const original = value.messages;

    applySubagentStatus(value, 'failed');

    expect(value.messages).toEqual([
      { text: 'Confirmed.', order: 1, messageId: 'message-1' },
      { text: 'Partial when the run died', order: 2 },
    ]);
    // Rewritten immutably: callers hand in shallow copies sharing this array.
    expect(value.messages).not.toBe(original);
  });

  it('leaves a settled transcript untouched on a terminal status', () => {
    const messages = [{ text: 'Confirmed.', order: 1, messageId: 'message-1' }];
    const value = subagent({ messages });
    applySubagentStatus(value, 'done');
    expect(value.messages).toBe(messages);
  });

  it('settles the live segment when durable text arrives', () => {
    const value = subagent({
      messages: [{ text: 'Foo is proved by si', order: 1, streaming: true }],
    });
    applySubagentText(value, 'Foo is proved by simp.');
    expect(value.text).toBe('Foo is proved by simp.');
    expect(value.messages).toEqual([{ text: 'Foo is proved by simp.', order: 1 }]);
  });

  it('appends a later durable text block to a settled transcript', () => {
    const value = subagent({
      messages: [{ text: 'First block.', order: 1 }],
    });
    applySubagentText(value, 'Second block.', 4);
    expect(value.text).toBe('Second block.');
    expect(value.messages).toEqual([
      { text: 'First block.', order: 1 },
      { text: 'Second block.', order: 4 },
    ]);
  });

  it('never derives a status from the text a child streams', () => {
    // Status arrives as its own lifecycle event. Text is transcript.
    const prover = subagent({ synthetic: 'prover' });
    const ordinary = subagent();
    applySubagentText(prover, 'PROVED: Foo.bar');
    applySubagentText(ordinary, 'PROVED: Foo.bar');
    expect(prover.status).toBe('running');
    expect(ordinary.status).toBe('running');
    expect(prover.text).toBe('PROVED: Foo.bar');
    expect(ordinary.text).toBe('PROVED: Foo.bar');
  });
  it('cancels active cards when the session stops', () => {
    const queued = subagent({ parentToolUseId: 'queued', status: 'queued' });
    const running = subagent({ parentToolUseId: 'running' });
    const done = subagent({ parentToolUseId: 'done', status: 'done' });
    const [cancelledQueued, cancelledRunning, unchanged] = cancelActiveSubagents([
      queued,
      running,
      done,
    ]);
    expect(cancelledQueued.status).toBe('cancelled');
    expect(cancelledRunning.status).toBe('cancelled');
    expect(cancelledQueued).not.toBe(queued);
    expect(cancelledRunning).not.toBe(running);
    expect(unchanged).toBe(done);
  });
  it('cancels active descendants without overwriting terminal outcomes', () => {
    const values = [
      subagent({ parentToolUseId: 'parent' }),
      subagent({ parentToolUseId: 'child', parentSubagentId: 'parent' }),
      subagent({ parentToolUseId: 'grandchild', parentSubagentId: 'child', status: 'queued' }),
      subagent({ parentToolUseId: 'done-child', parentSubagentId: 'parent', status: 'done' }),
    ];

    applySubagentStatusCascade(values, 'parent', 'cancelled');

    expect(values.map((value) => value.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'done',
    ]);
  });
  it.each([
    ['prover-tools', 'run_provers'],
    ['authoring-tools', 'formalize'],
    ['prover-tools', 'formalize'],
    ['authoring-tools', 'draft_blueprint'],
    ['authoring-tools', 'review_blueprint'],
    ['authoring-tools', 'review_proofs'],
  ])('hides legacy specialist children behind %s %s', (tool, summary) => {
    const parent = subagent({
      parentToolUseId: 'parent',
      toolCalls: [{
        tool, summary, hidden: false,
      }],
    });
    const specialist = subagent({
      parentToolUseId: 'specialist', parentSubagentId: 'parent',
      synthetic: 'regional-specialist', description: 'Formalizer pass 1',
    });
    const explore = subagent({
      parentToolUseId: 'explore', parentSubagentId: 'parent',
      synthetic: 'explore', description: 'Explore APIs',
    });
    const liveSpecialist = subagent({
      parentToolUseId: 'live-specialist', parentSubagentId: 'parent',
      synthetic: 'regional-specialist', description: 'Formalizer pass 1',
      batchId: 'formalize-batch-1', launcherTool: 'authoring-tools',
    });

    expect(displayedChildSubagents(parent, [specialist, liveSpecialist, explore]))
      .toEqual([explore]);
    expect(displayedChildSubagents(undefined, [specialist])).toEqual([specialist]);
  });

  it('indexes displayed children and keeps group selections referentially stable', () => {
    const parent = subagent({ parentToolUseId: 'parent' });
    const sibling = subagent({ parentToolUseId: 'sibling' });
    const child = subagent({
      parentToolUseId: 'child', parentSubagentId: 'parent',
    });
    const siblingChild = subagent({
      parentToolUseId: 'sibling-child', parentSubagentId: 'sibling',
    });
    const selectChildren = createDisplayedChildSubagentsSelector([
      parent,
      sibling,
      child,
      siblingChild,
    ]);

    expect(selectChildren([parent])).toBe(selectChildren([parent]));
    expect(selectChildren([parent])).toEqual([child]);
    expect(selectChildren([parent, sibling])).toBe(
      selectChildren([parent, sibling]),
    );
    expect(selectChildren([parent, sibling])).toEqual([child, siblingChild]);
  });
});
