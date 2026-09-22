import { isSpecialistAnchorRun, type SpecialistGrouping } from '@/features/chat/state/specialists';
import { isOutsideTranscriptTurn } from '@/features/chat/state/types';
import type { ActivityItem, ChatMessage, SubagentStream } from '@/features/chat/state/types';
import type {
  AssistantBlock,
  ChatTurn,
  RenderedAssistantBlock,
  RenderedChatTurn,
} from './types';

interface TurnAccumulator {
  turns: ChatTurn[];
  current: ChatTurn | null;
  messageOrdinal: number;
}

function isPendingOutsideTurn(message: ChatMessage): boolean {
  return message.role === 'user'
    && message.deliveryState === 'queued'
    && isOutsideTranscriptTurn(message);
}

function supersededTurn(message: ChatMessage, index: number): ChatTurn {
  return {
    id: `superseded-${message.messageId ?? index}`,
    userText: message.text,
    userContextAttachments: message.contextAttachments || [],
    assistantBlocks: [],
    hasUser: true,
    userDeliveryState: 'superseded',
    frozenActivities: [],
  };
}

function userTurn(message: ChatMessage, ordinal: number): ChatTurn {
  return {
    id: `turn-${ordinal}`,
    userText: message.text,
    userContextAttachments: message.contextAttachments || [],
    assistantBlocks: [],
    hasUser: true,
    userDeliveryState: message.deliveryState,
    frozenActivities: [],
  };
}

function agentOnlyTurn(ordinal: number): ChatTurn {
  return {
    id: `turn-agent-${ordinal}`,
    userText: '',
    userContextAttachments: [],
    assistantBlocks: [],
    hasUser: false,
    frozenActivities: [],
  };
}

function assistantBlock(turn: ChatTurn, message: ChatMessage): AssistantBlock {
  return {
    id: `${turn.id}-agent-${turn.assistantBlocks.length}`,
    text: message.text,
    streaming: message.streaming === true,
    isError: message.isError === true,
  };
}

function appendAgentMessage(accumulator: TurnAccumulator, message: ChatMessage): void {
  if (!accumulator.current) {
    accumulator.current = agentOnlyTurn(accumulator.messageOrdinal);
    accumulator.turns.push(accumulator.current);
  }
  if (!message.placeholder) {
    accumulator.messageOrdinal += 1;
    accumulator.current.assistantBlocks.push(assistantBlock(accumulator.current, message));
  }
  if (message.activities?.length) {
    accumulator.current.frozenActivities = [
      ...accumulator.current.frozenActivities,
      ...message.activities,
    ];
  }
}

function appendMessage(accumulator: TurnAccumulator, message: ChatMessage, index: number): void {
  if (isPendingOutsideTurn(message)) return;
  if (message.role === 'user' && message.deliveryState === 'superseded') {
    accumulator.turns.push(supersededTurn(message, index));
    return;
  }
  if (message.role === 'user') {
    accumulator.current = userTurn(message, accumulator.messageOrdinal);
    accumulator.turns.push(accumulator.current);
    accumulator.messageOrdinal += 1;
    return;
  }
  appendAgentMessage(accumulator, message);
}

/** Derive transcript turns while keeping placeholder rows out of anchor ordinals. */
export function deriveChatTurns(messages: readonly ChatMessage[]): ChatTurn[] {
  const accumulator: TurnAccumulator = { turns: [], current: null, messageOrdinal: 0 };
  messages.forEach((message, index) => appendMessage(accumulator, message, index));
  return accumulator.turns;
}

export function pendingUserMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter(isPendingOutsideTurn);
}

export function activityTurnId(turns: readonly ChatTurn[], latestTurnId: string | null): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].assistantBlocks.length) return turns[index].id;
  }
  return latestTurnId;
}

function renderedBlock(block: AssistantBlock): RenderedAssistantBlock {
  return {
    id: block.id,
    kind: 'message',
    text: block.text,
    state: block.streaming ? 'streaming' : 'complete',
    isError: block.isError,
  };
}

function renderedTurn(
  turn: ChatTurn,
  sending: boolean,
  latestTurnId: string | null,
  isStreaming: boolean,
): RenderedChatTurn {
  const assistantRenderedBlocks = turn.assistantBlocks.map(renderedBlock);
  const assistantPresent = assistantRenderedBlocks.length > 0;
  const assistantState = !assistantPresent
    ? (sending && latestTurnId === turn.id && !isStreaming ? 'typing' : 'none')
    : 'complete';
  return {
    ...turn,
    assistantRenderedBlocks,
    assistantPresent,
    assistantStreaming: turn.assistantBlocks.some((block) => block.streaming),
    assistantState,
  };
}

export function renderChatTurns(
  turns: readonly ChatTurn[],
  sending: boolean,
  latestTurnId: string | null,
  isStreaming: boolean,
): RenderedChatTurn[] {
  return turns.map((turn) => renderedTurn(turn, sending, latestTurnId, isStreaming));
}

function isVisibleTopLevelActivity(activity: ActivityItem, turnId: string): boolean {
  return activity.anchorTurnId === turnId
    && activity.tool !== 'Agent'
    && !activity.parentToolUseId
    && !activity.hidden;
}

export function turnHasActivity(
  turnId: string,
  frozenActivities: readonly ActivityItem[],
  activities: readonly ActivityItem[],
): boolean {
  return [...frozenActivities, ...activities].some((activity) =>
    isVisibleTopLevelActivity(activity, turnId));
}

export function subagentsForTurn(
  turnId: string,
  subagents: readonly SubagentStream[],
  specialists: SpecialistGrouping,
): SubagentStream[] {
  return subagents.filter((subagent) => {
    if (subagent.anchorTurnId !== turnId || subagent.parentSubagentId) return false;
    const group = specialists.groupByRunId.get(subagent.parentToolUseId);
    return !group || isSpecialistAnchorRun(group, subagent);
  });
}
