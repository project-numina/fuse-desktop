/**
 * Groups a standing specialist's runs into the single node ADR 051 renders.
 *
 * ADR 032 scoped a specialist to one invocation and posted a synthetic `Agent`
 * card per writer pass and per reviewer pass, so a three-pass formalize showed
 * six sub-cards and re-entering the loop showed six more. ADR 051 replaces that
 * with one node per specialist: the writer's runs and its reviewer's runs are
 * the same conversation, so they collapse into a node labelled for the role it
 * plays rather than for the pass it is on, and re-entering the loop fills the
 * node in further instead of starting a new one.
 *
 * This module owns the identity rule alone. Rendering lives in
 * `SpecialistCard` (the node) and `SubagentExpandedView` (the exchange).
 */

import { isLiveSubagentStatus } from '@/features/chat/state/subagents';
import type { SubagentStream } from '@/features/chat/state/types';

/**
 * Trailing pass suffix a card title may carry, in either the current shape
 * (`passLabel` is separate, so the description is bare) or the legacy shape
 * where the pass was baked into the persisted title ("Formalizer pass 1").
 */
const PASS_SUFFIX = /[\s·|–—-]*\bpass\s+\d+\s*$/i;

/**
 * A role title naming the reviewer half of a writer/reviewer pair. The bare
 * "Review" form only appears in transcripts persisted before the reviewer roles
 * shared one title, and is matched for the same reason the rest of this module
 * tolerates legacy titles.
 */
const REVIEWER_ROLE = /\breview(er)?\b/i;

/**
 * Role titles that belong to the authoring pairs. Used only to classify a
 * delegated region's children, whose `regional-specialist` tag covers its
 * provers as well; a prover card ("Prove thm:foo") keeps its own chrome.
 */
const AUTHORING_ROLE = /formaliz|blueprint|golf|review/i;

export interface SpecialistGroup {
  /** Stable identity across passes and re-entries, scoped to the owner. */
  key: string;
  /** Run id of the owning subagent, or `undefined` at the top level. */
  parentSubagentId?: string;
  /** Role title shown on the node, e.g. "Formalizer". */
  title: string;
  /** Every run of this specialist and its reviewer, oldest first. */
  members: SubagentStream[];
  anchorTurnId: string | null;
  anchorAfterMessageCount: number;
  /** Position of the specialist's first run, so the node sorts where it began. */
  order: number;
  status: SubagentStream['status'];
  /** Tool calls across the whole exchange, including runs not yet downloaded. */
  toolCallCount: number;
  /**
   * When the specialist first started, across every run it has had.
   *
   * The node reports one standing agent, so its span runs from the first run's
   * start to the last run's end, not the sum of the runs: the gaps between
   * them are time the specialist spent waiting to be addressed again, which is
   * still time it has been on this piece of work.
   */
  startedAt?: number;
  /** When its most recent run ended; absent while any run is still going. */
  endedAt?: number;
}

export interface SpecialistGrouping {
  groups: SpecialistGroup[];
  /** Every grouped run id mapped to the node that now represents it. */
  groupByRunId: Map<string, SpecialistGroup>;
}

const EMPTY_GROUPING: SpecialistGrouping = {
  groups: [],
  groupByRunId: new Map(),
};

/** Strip a pass suffix so every pass of one role reads as the same role. */
export function specialistRole(description: string): string {
  return description.replace(PASS_SUFFIX, '').trim() || description;
}

/** True when this run is a reviewer addressing its writer, not a writer. */
export function isReviewerRun(subagent: SubagentStream): boolean {
  return REVIEWER_ROLE.test(specialistRole(subagent.description));
}

/**
 * True when a run belongs to a standing specialist rather than to a bounded
 * per-call child.
 *
 * Top-level authoring runs always qualify. A delegated region tags every child
 * `regional-specialist`, so its authoring pairs are separated from its provers
 * by the structured launcher, falling back to the role title for transcripts
 * persisted before `launcher_tool` existed. Explore (ADR 037) and prover runs
 * are genuinely per-call and keep their own cards.
 */
export function isSpecialistRun(subagent: SubagentStream): boolean {
  if (subagent.synthetic === 'authoring') return true;
  if (subagent.synthetic !== 'regional-specialist') return false;
  if (subagent.launcherTool) return subagent.launcherTool === 'authoring-tools';
  return AUTHORING_ROLE.test(subagent.description);
}

function ownerKey(subagent: SubagentStream): string {
  return subagent.parentSubagentId ?? '';
}

/**
 * The identity of the specialist a writer run belongs to.
 *
 * An area of work rather than a call: the same role on the same artifact is one
 * standing specialist however many times it is addressed. `specialist_target`
 * is what tells two formalizers on two Lean files apart; a run without one
 * falls back to the role alone, which is how every transcript predating that
 * field grouped and must keep grouping. Composed through `JSON.stringify` so no
 * separator has to be assumed absent from a path.
 */
function roleKey(subagent: SubagentStream): string {
  return JSON.stringify([
    ownerKey(subagent),
    specialistRole(subagent.description).toLowerCase(),
    subagent.specialistTarget ?? '',
  ]);
}

/** Key under which a batch's writer is recorded for its reviewer to find. */
function batchKey(subagent: SubagentStream): string {
  return JSON.stringify([ownerKey(subagent), subagent.batchId ?? '']);
}

/**
 * Map each writer/reviewer batch to the key of the writer it belongs to.
 *
 * A reviewer's title is just "Reviewer" for all three reviewer roles, so the
 * writer it addresses is recovered from the batch the workflow stamped on both.
 * Resolved up front rather than by scan order because a resumed loop may run
 * the reviewer first (`start_with_review`).
 */
function writerKeyByBatch(runs: SubagentStream[]): Map<string, string> {
  const writers = new Map<string, string>();
  for (const run of runs) {
    if (!run.batchId || isReviewerRun(run)) continue;
    const batch = batchKey(run);
    if (!writers.has(batch)) writers.set(batch, roleKey(run));
  }
  return writers;
}

/**
 * Collapse the members' lifecycle states into the node's own.
 *
 * A live member speaks for the whole exchange, because the node is reporting a
 * standing agent rather than a finished call; otherwise the newest run does,
 * so a specialist that was sent back in and finished does not keep reporting
 * the failure that sent it back.
 */
function groupStatus(members: SubagentStream[]): SubagentStream['status'] {
  const live = activeMember(members);
  return live ? live.status : members[members.length - 1].status;
}

function activeMember(members: SubagentStream[]): SubagentStream | null {
  return members.find((member) => isLiveSubagentStatus(member.status)) ?? null;
}

/** Earliest start and latest end across a specialist's runs. */
function memberSpan(
  members: SubagentStream[],
): Pick<SpecialistGroup, 'startedAt' | 'endedAt'> {
  const startTimes = members
    .map((member) => member.startedAt)
    .filter((startedAt): startedAt is number => startedAt !== undefined);
  const latestMember = members[members.length - 1];
  return {
    ...(startTimes.length ? { startedAt: Math.min(...startTimes) } : {}),
    // The node spans through its newest run. An earlier pass's end is not a
    // valid substitute when that run is live or its terminal timestamp is
    // missing: using it would report a plausible but truncated duration for
    // work whose true end is unknown.
    ...(!activeMember(members) && latestMember?.endedAt !== undefined
      ? { endedAt: latestMember.endedAt }
      : {}),
  };
}

function countToolCalls(members: SubagentStream[]): number {
  return members.reduce(
    (total, member) => total + Math.max(
      member.toolCalls.filter((call) => !call.hidden).length,
      member.toolCallCount ?? 0,
    ),
    0,
  );
}

/** Group every specialist run into one node per specialist. */
export function buildSpecialistGroups(
  subagents: readonly SubagentStream[],
): SpecialistGrouping {
  const runs = subagents
    .filter(isSpecialistRun)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  if (!runs.length) return EMPTY_GROUPING;

  const writersByBatch = writerKeyByBatch(runs);
  // Legacy transcripts predate batch ids entirely; there the reviewer that
  // follows a writer is the reviewer of that writer, which is the sequence the
  // workflow has always run in.
  const latestUnbatchedWriter = new Map<string, string>();
  const membersByKey = new Map<string, SubagentStream[]>();
  const keyOrder: string[] = [];

  for (const run of runs) {
    const owner = ownerKey(run);
    let key = roleKey(run);
    if (isReviewerRun(run)) {
      const paired = run.batchId
        ? writersByBatch.get(batchKey(run))
        : latestUnbatchedWriter.get(owner);
      if (paired) key = paired;
    } else if (!run.batchId) {
      latestUnbatchedWriter.set(owner, key);
    }
    const members = membersByKey.get(key);
    if (members) members.push(run);
    else {
      membersByKey.set(key, [run]);
      keyOrder.push(key);
    }
  }

  const groupByRunId = new Map<string, SpecialistGroup>();
  const groups = keyOrder.map((key) => {
    const members = membersByKey.get(key) as SubagentStream[];
    const first = members[0];
    // The writer names the node: the reviewer is a second voice in its
    // conversation, not a specialist of its own.
    const writer = members.find((member) => !isReviewerRun(member)) ?? first;
    const group: SpecialistGroup = {
      key,
      ...(first.parentSubagentId
        ? { parentSubagentId: first.parentSubagentId }
        : {}),
      title: specialistRole(writer.description),
      members,
      anchorTurnId: first.anchorTurnId,
      anchorAfterMessageCount: first.anchorAfterMessageCount,
      order: first.order ?? 0,
      status: groupStatus(members),
      toolCallCount: countToolCalls(members),
      ...memberSpan(members),
    };
    for (const member of members) {
      groupByRunId.set(member.parentToolUseId, group);
    }
    return group;
  });

  return { groups, groupByRunId };
}

/** The run id a node expands to: its first run, which is its stable identity. */
export function specialistExpansionId(group: SpecialistGroup): string {
  return group.members[0].parentToolUseId;
}

/** True when this run is the one its node is rendered at. */
export function isSpecialistAnchorRun(
  group: SpecialistGroup,
  subagent: SubagentStream,
): boolean {
  return specialistExpansionId(group) === subagent.parentToolUseId;
}
