/** Rebuilds live-only chat UI state from a persisted transcript. */

import {
  BUILD_DISPLAY_PHASES,
  formatToolActivity,
  isBackgroundLogWrite,
} from '@/features/chat/state/activity';
import { buildPhaseToStep } from '@/features/chat/state/builds';
import {
  collectToolResults,
  parseToolHistoryEvent,
  TranscriptPosition,
} from '@/features/chat/state/history/transcript';
import { isSubagentSpawnTool } from '@/features/chat/state/subagents';
import type {
  ActivityItem,
  BuildActivity,
  PersistedChatMessage,
} from '@/features/chat/state/types';

export { attachActivitiesToMessages } from '@/features/chat/state/history/messages';
export { isPersistedMessageOutsideTranscriptTurn } from '@/features/chat/state/history/transcript';
export { reconstructHistorySubagents } from '@/features/chat/state/history/subagents';
export {
  hydratePersistedSubagents,
  mergePersistedSubagentTimeline,
} from '@/features/chat/state/history/subagent-hydration';

function finishBuilds(builds: BuildActivity[]): BuildActivity[] {
  for (const build of builds) {
    const lastStep = build.steps[build.steps.length - 1];
    if (lastStep?.status === 'running') lastStep.status = 'done';
    if (build.status !== 'failed') build.status = 'done';
  }
  return builds;
}

function appendBuildPhase(
  builds: BuildActivity[],
  currentBuild: BuildActivity | null,
  turnId: string | null,
  phase: string,
): BuildActivity | null {
  if (phase === 'failed' && currentBuild) {
    currentBuild.status = 'failed';
    return currentBuild;
  }
  const label = buildPhaseToStep(phase);
  if (!label || !BUILD_DISPLAY_PHASES.has(phase)) return currentBuild;
  let build = currentBuild;
  if (!build || build.turnId !== turnId) {
    build = {
      title: 'Preparing Lean environment',
      status: 'running',
      turnId,
      steps: [],
    };
    builds.push(build);
  }
  const lastStep = build.steps[build.steps.length - 1];
  if (lastStep?.status === 'running') lastStep.status = 'done';
  build.steps.push({ label, status: 'running' });
  return build;
}

export function reconstructHistoryBuilds(
  messages: PersistedChatMessage[],
  optimisticTurnMessageIds?: ReadonlySet<string>,
): BuildActivity[] {
  const builds: BuildActivity[] = [];
  const position = new TranscriptPosition();
  let currentBuild: BuildActivity | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      const previousTurnId = position.currentTurnId;
      position.observe(message, optimisticTurnMessageIds);
      if (position.currentTurnId !== previousTurnId) currentBuild = null;
      continue;
    }
    if (position.observe(message, optimisticTurnMessageIds)) continue;
    const event = parseToolHistoryEvent(message);
    if (event?.kind !== 'build_status') continue;
    currentBuild = appendBuildPhase(
      builds,
      currentBuild,
      position.currentTurnId,
      event.phase || '',
    );
  }
  return finishBuilds(builds);
}

export function reconstructHistoryActivities(
  messages: PersistedChatMessage[],
  optimisticTurnMessageIds?: ReadonlySet<string>,
): ActivityItem[] {
  const activities: ActivityItem[] = [];
  const toolResults = collectToolResults(messages);
  const position = new TranscriptPosition();
  for (const [messageIndex, message] of messages.entries()) {
    if (position.observe(message, optimisticTurnMessageIds)) continue;
    const event = parseToolHistoryEvent(message);
    if (!event?.tool || event.kind !== 'tool_call') continue;
    if (isBackgroundLogWrite(event) || event.is_subagent) continue;
    if (isSubagentSpawnTool(event.tool)) continue;
    const item = formatToolActivity(event.tool, event.input || {});
    item.anchorTurnId = position.currentTurnId;
    item.anchorAfterMessageCount = position.assistantMessageCount;
    item.order = messageIndex;
    if (event.tool_use_id) item.toolUseId = event.tool_use_id;
    const result = event.tool_use_id ? toolResults.get(event.tool_use_id) : undefined;
    if (result) {
      item.isError = result.isError;
      item.result = result.result;
    }
    activities.push(item);
  }
  return activities;
}
