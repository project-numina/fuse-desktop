/**
 * Subagent card status helpers, shared by the live SSE handler and history
 * reconstruction so a reloaded session shows the same terminal
 * outcome it showed live.
 */

import type { SubagentMessage, SubagentStream } from '@/features/chat/state/types';

/**
 * Maps a backend `agent_status` value to a subagent card status.
 */
export const SUBAGENT_STATUS_BY_EVENT: Record<string, SubagentStream['status']> = {
  running: 'running',
  proved: 'proved',
  completed: 'done',
  failed: 'failed',
  stopped: 'cancelled',
};

// Synthetic subagent cards (prover runs, authoring writer/reviewer passes) are
// posted by an MCP tool and must anchor back to that tool call's position so
// they stack as sub-cards in one block. Maps the spawn event's `synthetic_for`
// to the batch tool whose latest call they belong under.
export const SYNTHETIC_ANCHOR_TOOLS: Record<string, string> = {
  prover: 'prover-tools',
  authoring: 'authoring-tools',
  // A top-level explore (orchestrator-called) anchors to its authoring-tools
  // call so it lands at the call site on reload; the no-coalesce rule keeps it a
  // standalone card. A subagent-initiated explore carries parentSubagentId and
  // renders nested instead, so this only affects the top-level case.
  explore: 'authoring-tools',
  // A merger is launched by the backend inside a repo-git merge call, so its
  // card stacks under that call rather than opening at the top level.
  merger: 'repo-git',
};

/**
 * True when a tool call is a subagent spawn rather than ordinary tool activity.
 *
 * `Agent` is the name the backend publishes for every spawn it synthesizes
 * itself, and is also the SDK's current name for a model-issued spawn. `Task` is
 * the SDK's legacy name for the same model-issued spawn and can still reach the
 * client verbatim from the orchestrator's raw `tool_use` blocks, so both names
 * open a card. Shared by the live SSE handler and history reconstruction: a
 * spawn recognized on one path but not the other is a card that appears only
 * live or only after a reload.
 */
export function isSubagentSpawnTool(tool: string | null | undefined): boolean {
  return tool === 'Agent' || tool === 'Task';
}

/**
 * Returns the `synthetic_for` tag of a backend-synthesized spawn, else null.
 *
 * Deliberately narrower than {@link isSubagentSpawnTool}: `synthetic_for` is set
 * only by backend code that hardcodes `"tool": "Agent"` (the child-agent runtime
 * and the prover-batch driver), and every child-forwarding path drops nested
 * `Agent`/`Task` blocks outright, so a synthetic spawn can never arrive as
 * `Task`. Accepting `Task` here would document a case the backend cannot
 * produce; requiring `Agent` on only one of the live/history paths produced a
 * card whose synthetic metadata changed across a reload.
 */
export function syntheticSpawnFor(
  tool: string | null | undefined,
  input: Record<string, unknown>,
): string | null {
  if (tool !== 'Agent') return null;
  return typeof input.synthetic_for === 'string' ? input.synthetic_for : null;
}

const REGIONAL_WORKFLOW_ACTIONS = new Set([
  'draft_blueprint',
  'formalize',
  'review_blueprint',
  'review_proofs',
  'run_provers',
]);

/**
 * Keep regional specialist runs out of a delegated parent's compact preview
 * when the parent already shows the workflow tool that launched them. The
 * expanded parent timeline receives the complete child list separately and
 * renders those specialists as individual cards at the launcher position.
 */
export function displayedChildSubagents(
  parent: SubagentStream | undefined,
  children: SubagentStream[],
): SubagentStream[] {
  const hasRegionalWorkflow = parent?.toolCalls.some(
    (call) => (
      call.tool === 'authoring-tools' || call.tool === 'prover-tools'
    ) && REGIONAL_WORKFLOW_ACTIONS.has(call.summary ?? ''),
  ) ?? false;
  if (!hasRegionalWorkflow) return children;
  return children.filter(
    (child) => child.synthetic !== 'regional-specialist',
  );
}

/**
 * Build a stable group-to-children selector for collapsed cards. The chat
 * store updates frequently, so callers memoize this selector by the subagent
 * array and receive the same child-array identity until that state changes.
 */
export function createDisplayedChildSubagentsSelector(
  subagents: SubagentStream[],
): (group: readonly SubagentStream[]) => SubagentStream[] {
  const parentsById = new Map(
    subagents.map((subagent) => [subagent.parentToolUseId, subagent]),
  );
  const childrenByParent = new Map<string, SubagentStream[]>();
  for (const child of subagents) {
    if (!child.parentSubagentId) continue;
    const children = childrenByParent.get(child.parentSubagentId) ?? [];
    children.push(child);
    childrenByParent.set(child.parentSubagentId, children);
  }

  const displayedByParent = new Map<string, SubagentStream[]>();
  for (const [parentId, parent] of parentsById) {
    displayedByParent.set(
      parentId,
      displayedChildSubagents(parent, childrenByParent.get(parentId) ?? []),
    );
  }

  const groups = new Map<string, SubagentStream[]>();
  return (group) => {
    if (group.length === 1) {
      return displayedByParent.get(group[0].parentToolUseId) ?? [];
    }
    const key = JSON.stringify(group.map((member) => member.parentToolUseId));
    const cached = groups.get(key);
    if (cached) return cached;
    const children = group.flatMap(
      (member) => displayedByParent.get(member.parentToolUseId) ?? [],
    );
    groups.set(key, children);
    return children;
  };
}

const TERMINAL_SUBAGENT_STATUSES = new Set<SubagentStream['status']>([
  'done',
  'proved',
  'failed',
  'cancelled',
]);

/**
 * Settles a child's trailing live segment, if it still has one.
 *
 * Called at boundaries that end the streamed message. The segment is kept —
 * with `delta_kind` routing it holds the child's prose, which is worth showing
 * even when the run died before publishing the durable copy — but it stops
 * claiming to be streaming, so nothing is left dangling for the session's life.
 * Rewrites `messages` immutably: callers hand in shallow subagent copies that
 * still share the original array.
 */
export function settleStreamingSubagentMessage(subagent: SubagentStream): void {
  const messages = subagent.messages;
  if (!messages?.length) return;
  const last = messages[messages.length - 1];
  if (!last.streaming) return;
  const settled: SubagentMessage = {
    text: last.text,
    order: last.order,
    ...(last.messageId ? { messageId: last.messageId } : {}),
  };
  subagent.messages = [...messages.slice(0, -1), settled];
}

/** True while a run may still do more: waiting for a slot, or going. */
export function isLiveSubagentStatus(
  status: SubagentStream['status'],
): boolean {
  return !TERMINAL_SUBAGENT_STATUSES.has(status);
}

/**
 * Apply one lifecycle verdict to a card.
 *
 * @param subagent Card to settle, already a copy the caller may mutate.
 * @param status The published lifecycle state.
 * @param endedAt Epoch milliseconds this run reached a terminal state, for
 *     callers watching it live. History replay leaves it out: its runs ended
 *     whenever the backend says they did, not when the transcript was reopened.
 */
export function applySubagentStatus(
  subagent: SubagentStream,
  status: SubagentStream['status'],
  endedAt?: number,
): void {
  // Only the backend lifecycle verdict may set 'proved'. A prover writing
  // "PROVED:" in its prose is making a claim, and must not override a
  // published failure.
  subagent.status = status;
  // A finished child will never publish the durable copy of whatever it was
  // mid-way through streaming, so that segment is settled here instead of
  // staying marked streaming forever.
  if (TERMINAL_SUBAGENT_STATUSES.has(subagent.status)) {
    settleStreamingSubagentMessage(subagent);
    // First terminal verdict wins, matching how the backend dates a run: a
    // later restatement does not move the moment the work stopped.
    if (endedAt !== undefined && subagent.endedAt === undefined) {
      subagent.endedAt = endedAt;
    }
  }
}

/**
 * Apply one lifecycle event and close any still-active descendants when their
 * parent is cancelled. Older transcripts may lack a terminal event for nested
 * synthetic agents, so the parent cancellation is their durable fallback.
 */
export function applySubagentStatusCascade(
  subagents: SubagentStream[],
  targetId: string,
  status: SubagentStream['status'],
  endedAt?: number,
): void {
  const target = subagents.find(
    (subagent) => subagent.parentToolUseId === targetId,
  );
  if (!target) return;
  applySubagentStatusCascadeTo(subagents, target, status, endedAt);
}

/**
 * Same cascade, for callers that already hold the target (history
 * reconstruction resolves it through its own index) and should not pay a second
 * linear scan per status event.
 */
export function applySubagentStatusCascadeTo(
  subagents: SubagentStream[],
  target: SubagentStream,
  status: SubagentStream['status'],
  endedAt?: number,
): void {
  applySubagentStatus(target, status, endedAt);
  if (status !== 'cancelled') return;

  const cancelledParents = new Set([target.parentToolUseId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const subagent of subagents) {
      if (
        !subagent.parentSubagentId
        || !cancelledParents.has(subagent.parentSubagentId)
        || cancelledParents.has(subagent.parentToolUseId)
      ) {
        continue;
      }
      cancelledParents.add(subagent.parentToolUseId);
      foundDescendant = true;
      if (isLiveSubagentStatus(subagent.status)) {
        applySubagentStatus(subagent, 'cancelled', endedAt);
      }
    }
  }
}

/**
 * Cancel any subagents that are still queued or running when the session stops.
 *
 * A user stop closes the SSE stream before the backend's terminal
 * `agent_status: stopped` events can arrive, so a subagent left `running`
 * would keep its card shimmering forever and a queued one would never reach a
 * terminal state. This applies the same `cancelled` mapping as a live stopped
 * event, returning a fresh array with new object references only for the cards
 * it changes.
 */
export function cancelActiveSubagents(
  subagents: SubagentStream[],
  endedAt?: number,
): SubagentStream[] {
  return subagents.map((subagent) => {
    if (!isLiveSubagentStatus(subagent.status)) return subagent;
    const settled = { ...subagent };
    applySubagentStatus(settled, 'cancelled', endedAt);
    return settled;
  });
}

export function applySubagentText(
  subagent: SubagentStream,
  text: string,
  order?: number,
): void {
  subagent.text = text;
  // The durable text supersedes whatever was streamed for that message. Keep
  // its position in the interleaved timeline, but replace the partial buffer
  // instead of merely marking the partial text as complete. SDK-native children
  // publish `subagent_text` rather than `subagent_message`, so this is the only
  // durable copy their visible timeline receives.
  const messages = subagent.messages;
  const last = messages?.[messages.length - 1];
  if (messages && last?.streaming) {
    subagent.messages = [
      ...messages.slice(0, -1),
      {
        text,
        order: last.order,
        ...(last.messageId ? { messageId: last.messageId } : {}),
      },
    ];
  // SDK-native children may publish several final TextBlocks for one assistant
  // message. Their first block settles the streamed buffer; retain later
  // blocks as separate visible segments. Synthetic agents have their own
  // durable message protocol, where subagent_text is only a final summary.
  } else if (
    !subagent.synthetic
    && messages?.length
    && last?.text !== text
  ) {
    subagent.messages = [
      ...messages,
      {
        text,
        order: order ?? (last?.order ?? subagent.order ?? 0) + 1,
      },
    ];
  }
}
