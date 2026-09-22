import type { AgentEvent } from '@shared/agent-events';
import type {
  BuildStatus,
  ChatContextAttachmentPayload,
  MessageDeliveryState,
  SessionChatMessage,
} from '@shared/api-types';
import type { SseRoom } from '../../../server/sse';
import type { TranscriptRow } from '../../../store/rows';
import type { OpenProject } from '../../types';
import type { AttachmentPromptContext } from '../attachments';
import type { LocalSession } from '.';

export interface QueuedUserMessage {
  messageId: string;
  content: string;
  contextAttachments: ChatContextAttachmentPayload[];
}

export type TurnKind = 'initial' | 'follow_up' | 'control';

export interface TurnRecord {
  turnId: string;
  kind: TurnKind;
  /** The user text that opened the turn (commit subject); empty for control turns. */
  userMessage: string;
  startedAt: number;
  wroteLeanFiles: boolean;
  hadError: boolean;
  lastActivityAt: number;
}

export type TurnEndEvent = Extract<AgentEvent, { kind: 'turn_completed' | 'turn_interrupted' | 'turn_failed' }>;

export interface TranscriptWriter {
  appendRow(row: TranscriptRow, boundaryEventId: number | null): void;
  setDeliveryState(messageId: string, state: MessageDeliveryState, options?: { preserveDeliveredAt?: boolean }): void;
  advanceBoundary(eventId: number): void;
}

export interface SteerTarget {
  steer(text: string): Promise<void>;
}

export interface SessionHooks {
  onTurnEnded(session: LocalSession, event: TurnEndEvent, turn: TurnRecord): void;
  onThreadStarted?(session: LocalSession, providerThreadId: string, model: string | null): void;
  onEvent?(session: LocalSession, event: AgentEvent): void;
}

export interface LocalSessionInit {
  sessionId: string;
  conversationId: string;
  agentJobId: string;
  project: OpenProject;
  room: SseRoom;
  transcript: TranscriptWriter;
  hooks: SessionHooks;
  attachmentContext: AttachmentPromptContext | null;
  initialMessages: SessionChatMessage[];
  model: string | null;
  providerThreadId: string | null;
  now?: () => number;
  buildStatus?: () => BuildStatus;
}
