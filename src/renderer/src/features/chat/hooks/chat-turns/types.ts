import type { SpecialistGroup } from '@/features/chat/state/specialists';
import type {
  ActivityItem,
  ChatContextAttachment,
  ChatMessage,
  MessageDeliveryState,
  SubagentStream,
} from '@/features/chat/state/types';

export interface AssistantBlock {
  id: string;
  text: string;
  streaming: boolean;
  isError: boolean;
}

export interface ChatTurn {
  id: string;
  userText: string;
  userContextAttachments: ChatContextAttachment[];
  assistantBlocks: AssistantBlock[];
  hasUser: boolean;
  userDeliveryState?: MessageDeliveryState;
  frozenActivities: ActivityItem[];
}

export interface RenderedAssistantBlock {
  id: string;
  kind: 'message';
  text: string;
  state: 'streaming' | 'complete';
  isError: boolean;
}

export interface RenderedChatTurn extends ChatTurn {
  assistantRenderedBlocks: RenderedAssistantBlock[];
  assistantPresent: boolean;
  assistantStreaming: boolean;
  assistantState: 'none' | 'typing' | 'complete';
}

export type BucketEntry =
  | { kind: 'subagents'; subagents: SubagentStream[]; key: string }
  | { kind: 'specialist'; group: SpecialistGroup; key: string }
  | { kind: 'activity'; activity: ActivityItem; key: string; count: number };

export interface ChatTurnsState {
  messages: ChatMessage[];
  activities: ActivityItem[];
  subagents: SubagentStream[];
  sending: boolean;
}
