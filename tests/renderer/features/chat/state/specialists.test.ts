import { describe, expect, it } from 'vitest';
import {
  buildSpecialistGroups,
  isSpecialistRun,
  specialistRole,
} from '@/features/chat/state/specialists';
import type { SubagentStream } from '@/features/chat/state/types';

const run = (
  id: string,
  order: number,
  overrides: Partial<SubagentStream> = {},
): SubagentStream => ({
  parentToolUseId: id,
  anchorTurnId: 'turn-0',
  anchorAfterMessageCount: 0,
  description: 'Formalizer',
  model: null,
  text: '',
  toolCalls: [],
  status: 'done',
  synthetic: 'authoring',
  order,
  ...overrides,
});

describe('buildSpecialistGroups', () => {
  it('spans a specialist from its first run to its last, not run by run', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, { batchId: 'a', startedAt: 1_000, endedAt: 5_000 }),
      run('r1', 2, {
        description: 'Reviewer',
        batchId: 'a',
        startedAt: 6_000,
        endedAt: 9_000,
      }),
      run('w2', 3, { batchId: 'a', startedAt: 40_000, endedAt: 135_000 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].startedAt).toBe(1_000);
    expect(groups[0].endedAt).toBe(135_000);
  });

  it('leaves a specialist with a live run still counting up', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, { batchId: 'a', startedAt: 1_000, endedAt: 5_000 }),
      run('r1', 2, {
        description: 'Reviewer',
        batchId: 'a',
        status: 'running',
        startedAt: 6_000,
      }),
    ]);

    expect(groups[0].startedAt).toBe(1_000);
    expect(groups[0].status).toBe('running');
    expect(groups[0].endedAt).toBeUndefined();
  });

  it('does not reuse an earlier pass end when the latest end is unknown', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, { batchId: 'a', startedAt: 1_000, endedAt: 5_000 }),
      run('r1', 2, {
        description: 'Reviewer',
        batchId: 'a',
        status: 'done',
        startedAt: 6_000,
      }),
    ]);

    expect(groups[0].startedAt).toBe(1_000);
    expect(groups[0].status).toBe('done');
    expect(groups[0].endedAt).toBeUndefined();
  });

  it('claims no span for runs the transcript could not date', () => {
    const { groups } = buildSpecialistGroups([run('w1', 1, { batchId: 'a' })]);

    expect(groups[0].startedAt).toBeUndefined();
    expect(groups[0].endedAt).toBeUndefined();
  });

  it('collapses every pass and its reviewer into one node', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, { passLabel: 'Pass 1', batchId: 'formalize-a' }),
      run('r1', 2, { description: 'Reviewer', batchId: 'formalize-a' }),
      run('w2', 3, { passLabel: 'Pass 2', batchId: 'formalize-a' }),
      run('r2', 4, { description: 'Reviewer', batchId: 'formalize-a' }),
      run('w3', 5, { passLabel: 'Pass 3', batchId: 'formalize-a' }),
      run('r3', 6, { description: 'Reviewer', batchId: 'formalize-a' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Formalizer');
    expect(groups[0].members.map((member) => member.parentToolUseId)).toEqual([
      'w1', 'r1', 'w2', 'r2', 'w3', 'r3',
    ]);
    expect(groups[0].order).toBe(1);
  });

  it('keeps a re-entered specialist in the node it already has', () => {
    const { groups, groupByRunId } = buildSpecialistGroups([
      run('w1', 1, { batchId: 'formalize-a' }),
      run('r1', 2, { description: 'Reviewer', batchId: 'formalize-a' }),
      // The orchestrator sends the same formalizer back in: a new call, a new
      // batch, and a later anchor — but the same standing specialist.
      run('w2', 9, {
        batchId: 'formalize-b',
        anchorTurnId: 'turn-2',
        anchorAfterMessageCount: 3,
      }),
      run('r2', 10, {
        description: 'Reviewer',
        batchId: 'formalize-b',
        anchorTurnId: 'turn-2',
        anchorAfterMessageCount: 3,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(4);
    // The node stays where the specialist first appeared rather than jumping
    // to wherever the latest instruction landed.
    expect(groups[0].anchorTurnId).toBe('turn-0');
    expect(groups[0].anchorAfterMessageCount).toBe(0);
    expect(groupByRunId.get('w2')).toBe(groups[0]);
  });

  it('gives each specialist its own node and each reviewer its own writer', () => {
    const { groups } = buildSpecialistGroups([
      run('b1', 1, { description: 'Blueprint writer', batchId: 'draft-a' }),
      run('bReview', 2, { description: 'Reviewer', batchId: 'draft-a' }),
      run('f1', 3, { batchId: 'formalize-a' }),
      run('fReview', 4, { description: 'Reviewer', batchId: 'formalize-a' }),
    ]);

    expect(groups.map((group) => group.title)).toEqual([
      'Blueprint writer',
      'Formalizer',
    ]);
    expect(groups[0].members.map((member) => member.parentToolUseId))
      .toEqual(['b1', 'bReview']);
    expect(groups[1].members.map((member) => member.parentToolUseId))
      .toEqual(['f1', 'fReview']);
  });

  it('pairs a resumed loop that reviews before it writes', () => {
    const { groups } = buildSpecialistGroups([
      run('r1', 1, { description: 'Reviewer', batchId: 'formalize-a' }),
      run('w1', 2, { batchId: 'formalize-a' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Formalizer');
  });

  it('pairs legacy passes with no batch id by the writer they follow', () => {
    const { groups } = buildSpecialistGroups([
      run('b1', 1, { description: 'Blueprint writer pass 1', batchId: undefined }),
      run('bReview', 2, { description: 'Review pass 1', batchId: undefined }),
      run('f1', 3, { description: 'Formalizer pass 1', batchId: undefined }),
      run('fReview', 4, { description: 'Review pass 1', batchId: undefined }),
      run('f2', 5, { description: 'Formalizer pass 2', batchId: undefined }),
    ]);

    expect(groups.map((group) => group.title)).toEqual([
      'Blueprint writer',
      'Formalizer',
    ]);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].members.map((member) => member.parentToolUseId))
      .toEqual(['f1', 'fReview', 'f2']);
  });

  it('leaves per-call children out of specialist grouping', () => {
    const { groups, groupByRunId } = buildSpecialistGroups([
      run('prove-1', 1, { description: 'Prove thm:foo', synthetic: 'prover' }),
      run('explore-1', 2, { description: 'Explore files', synthetic: 'explore' }),
      run('regional-prove', 3, {
        description: 'Prove thm:bar',
        synthetic: 'regional-specialist',
        launcherTool: 'prover-tools',
      }),
    ]);

    expect(groups).toEqual([]);
    expect(groupByRunId.size).toBe(0);
  });

  it('groups a delegated region’s authoring children, scoped to that region', () => {
    const { groups } = buildSpecialistGroups([
      run('outer', 1),
      run('inner', 2, {
        synthetic: 'regional-specialist',
        launcherTool: 'authoring-tools',
        parentSubagentId: 'region-1',
      }),
      run('inner-review', 3, {
        description: 'Reviewer',
        synthetic: 'regional-specialist',
        launcherTool: 'authoring-tools',
        parentSubagentId: 'region-1',
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].members.map((member) => member.parentToolUseId))
      .toEqual(['outer']);
    expect(groups[1].parentSubagentId).toBe('region-1');
    expect(groups[1].members.map((member) => member.parentToolUseId))
      .toEqual(['inner', 'inner-review']);
  });

  it('separates two specialists of one role by the artifact each works', () => {
    const { groups } = buildSpecialistGroups([
      run('basic-w1', 1, {
        batchId: 'formalize-a',
        specialistTarget: 'lean/Project/Basic.lean',
      }),
      run('scales-w1', 2, {
        batchId: 'formalize-b',
        specialistTarget: 'lean/Project/Scales.lean',
      }),
      run('basic-r1', 3, {
        description: 'Reviewer',
        batchId: 'formalize-a',
        specialistTarget: 'lean/Project/Basic.lean',
      }),
      run('scales-r1', 4, {
        description: 'Reviewer',
        batchId: 'formalize-b',
        specialistTarget: 'lean/Project/Scales.lean',
      }),
      // A later instruction to the first file's formalizer joins the node it
      // already has rather than opening a third.
      run('basic-w2', 5, {
        batchId: 'formalize-c',
        specialistTarget: 'lean/Project/Basic.lean',
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].members.map((member) => member.parentToolUseId))
      .toEqual(['basic-w1', 'basic-r1', 'basic-w2']);
    expect(groups[1].members.map((member) => member.parentToolUseId))
      .toEqual(['scales-w1', 'scales-r1']);
  });

  it('pairs a reviewer with a writer only the writer named an artifact for', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, {
        batchId: 'formalize-a',
        specialistTarget: 'lean/Project/Basic.lean',
      }),
      // Defensive: the pair is one node even if only the writer names what it
      // is working, because the batch is what pairs them.
      run('r1', 2, { description: 'Reviewer', batchId: 'formalize-a' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it('groups a transcript with no targets exactly as it did before', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, { batchId: 'formalize-a' }),
      run('r1', 2, { description: 'Reviewer', batchId: 'formalize-a' }),
      run('w2', 3, { batchId: 'formalize-b' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it('reports the newest settled run once nothing is live', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, { status: 'failed', batchId: 'formalize-a' }),
      run('w2', 2, { status: 'done', batchId: 'formalize-b' }),
    ]);
    expect(groups[0].status).toBe('done');
  });

  it('counts the whole exchange, including runs not yet downloaded', () => {
    const { groups } = buildSpecialistGroups([
      run('w1', 1, {
        toolCalls: [
          { tool: 'Read', summary: 'A.lean' },
          { tool: 'Grep', summary: 'x', hidden: true },
        ],
      }),
      run('r1', 2, {
        description: 'Reviewer',
        toolCalls: [],
        toolCallCount: 4,
      }),
    ]);
    expect(groups[0].toolCallCount).toBe(5);
  });
});

describe('specialistRole', () => {
  it.each([
    ['Formalizer', 'Formalizer'],
    ['Formalizer pass 1', 'Formalizer'],
    ['Formalizer · pass 12', 'Formalizer'],
    ['Reviewer', 'Reviewer'],
  ])('reads %s as %s', (description, role) => {
    expect(specialistRole(description)).toBe(role);
  });
});

describe('isSpecialistRun', () => {
  it('recognizes a legacy regional authoring child by its role title', () => {
    expect(isSpecialistRun(run('a', 1, {
      description: 'Formalizer pass 1',
      synthetic: 'regional-specialist',
    }))).toBe(true);
    expect(isSpecialistRun(run('b', 1, {
      description: 'Repair the project build',
      synthetic: 'regional-specialist',
    }))).toBe(false);
  });
});
