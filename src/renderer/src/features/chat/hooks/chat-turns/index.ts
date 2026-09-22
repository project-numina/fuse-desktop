import { useCallback, useMemo } from 'react';

import {
  buildSpecialistGroups,
  type SpecialistGrouping,
} from '@/features/chat/state/specialists';
import type {
  ActivityItem,
  ChatMessage,
  SubagentStream,
} from '@/features/chat/state/types';
import { buildBucketEntries } from './buckets';
import {
  activityTurnId as deriveActivityTurnId,
  deriveChatTurns,
  pendingUserMessages as derivePendingUserMessages,
  renderChatTurns,
  subagentsForTurn as deriveSubagentsForTurn,
  turnHasActivity as deriveTurnHasActivity,
} from './derivation';
import type { BucketEntry, ChatTurnsState } from './types';

export type {
  BucketEntry,
  ChatTurn,
  ChatTurnsState,
  RenderedAssistantBlock,
  RenderedChatTurn,
} from './types';

function useTranscriptTurns(messages: ChatMessage[], sending: boolean) {
  const isStreaming = useMemo(
    () => messages.some((message) => message.streaming === true),
    [messages],
  );
  const pendingUserMessages = useMemo(
    () => derivePendingUserMessages(messages),
    [messages],
  );
  const turns = useMemo(() => deriveChatTurns(messages), [messages]);
  const latestTurnId = useMemo(
    () => turns[turns.length - 1]?.id ?? null,
    [turns],
  );
  const activityTurnId = useMemo(
    () => deriveActivityTurnId(turns, latestTurnId),
    [turns, latestTurnId],
  );
  const renderedTurns = useMemo(
    () => renderChatTurns(turns, sending, latestTurnId, isStreaming),
    [turns, latestTurnId, isStreaming, sending],
  );
  return { turns, latestTurnId, activityTurnId, renderedTurns, pendingUserMessages };
}

function useTurnLookups(
  activities: ActivityItem[],
  subagents: SubagentStream[],
  specialists: SpecialistGrouping,
) {
  const turnHasActivity = useCallback(
    (turnId: string, frozen: ActivityItem[]) =>
      deriveTurnHasActivity(turnId, frozen, activities || []),
    [activities],
  );
  const subagentsForTurn = useCallback(
    (turnId: string): SubagentStream[] =>
      deriveSubagentsForTurn(turnId, subagents || [], specialists),
    [specialists, subagents],
  );
  const bucketEntries = useCallback(
    (turnId: string, messageCount: number, frozen: ActivityItem[]): BucketEntry[] =>
      buildBucketEntries(
        turnId,
        messageCount,
        frozen,
        activities || [],
        subagents || [],
        specialists,
      ),
    [activities, specialists, subagents],
  );
  return { turnHasActivity, subagentsForTurn, bucketEntries };
}

/** Memoized renderer-facing view of the flat chat transcript state. */
export function useChatTurns(state: ChatTurnsState) {
  const { messages, activities, subagents, sending } = state;
  const specialists = useMemo(
    () => buildSpecialistGroups(subagents || []),
    [subagents],
  );
  const transcript = useTranscriptTurns(messages, sending);
  const lookups = useTurnLookups(activities, subagents, specialists);

  return {
    turns: transcript.turns,
    latestTurnId: transcript.latestTurnId,
    activityTurnId: transcript.activityTurnId,
    renderedTurns: transcript.renderedTurns,
    pendingUserMessages: transcript.pendingUserMessages,
    bucketEntries: lookups.bucketEntries,
    turnHasActivity: lookups.turnHasActivity,
    subagentsForTurn: lookups.subagentsForTurn,
    specialists,
  };
}
