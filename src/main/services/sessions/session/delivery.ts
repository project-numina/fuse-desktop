import type { MessageDeliveryState, SessionChatMessage } from '@shared/api-types';
import type { AttachmentPromptContext } from '../attachments';
import { buildSteeringMessage } from '../prompts';
import type { QueuedUserMessage, SteerTarget, TranscriptWriter } from './types';

interface DeliveryContext {
  turnIsLive: boolean;
  userStopRequested: boolean;
  hasCurrentTurn: boolean;
  steerTarget: SteerTarget | null;
}

interface SessionMessageDeliveryInit {
  messages: SessionChatMessage[];
  transcript: TranscriptWriter;
  attachmentContext: AttachmentPromptContext | null;
  publish: (event: string, data: unknown) => number;
}

export class SessionMessageDelivery {
  readonly queue: QueuedUserMessage[] = [];
  readonly pendingSteers: QueuedUserMessage[] = [];
  readonly unconfirmedSteers: QueuedUserMessage[] = [];
  readonly acceptedStates = new Map<string, MessageDeliveryState>();
  readonly retainedMessageIds: string[] = [];

  constructor(private readonly init: SessionMessageDeliveryInit) {}

  get pendingCount(): number {
    return this.queue.length + this.pendingSteers.length + this.unconfirmedSteers.length;
  }

  announceAccepted(message: QueuedUserMessage): void {
    this.acceptedStates.set(message.messageId, 'queued');
    const chat = this.chatMessage(message, 'queued');
    this.init.publish('chat', chat);
  }

  recordState(
    message: QueuedUserMessage,
    state: MessageDeliveryState,
    options: { preserveTranscriptPosition?: boolean } = {},
  ): void {
    const previous = this.acceptedStates.get(message.messageId);
    this.acceptedStates.set(message.messageId, state);
    const delivered = state === 'delivered' || state === 'steered';
    if (delivered && !options.preserveTranscriptPosition) this.moveMessageToDeliveryPoint(message, state);
    else this.updateMessageInPlace(message.messageId, state);
    if (previous !== state || state === 'queued') {
      this.init.publish('message_delivery', { message_id: message.messageId, state });
    }
    this.init.transcript.setDeliveryState(message.messageId, state, {
      preserveDeliveredAt: options.preserveTranscriptPosition === true,
    });
  }

  enqueue(message: QueuedUserMessage, atFront = false): void {
    if (atFront) this.queue.unshift(message);
    else this.queue.push(message);
  }

  drainQueue(): QueuedUserMessage[] {
    return this.queue.splice(0, this.queue.length);
  }

  confirmSteers(): void {
    const confirmed = this.unconfirmedSteers.splice(0);
    for (const message of confirmed) this.recordState(message, 'steered');
  }

  requeueSteers(): void {
    const messages = [...this.unconfirmedSteers.splice(0), ...this.pendingSteers.splice(0)];
    for (let index = messages.length - 1; index >= 0; index -= 1) this.enqueue(messages[index], true);
    for (const message of messages) this.recordState(message, 'queued');
  }

  /** Writes only at a proven live point; failed writes return to the queue. */
  deliverPendingSteers(context: DeliveryContext): void {
    if (this.pendingSteers.length === 0 || !context.turnIsLive) return;
    if (context.userStopRequested || !context.steerTarget || !context.hasCurrentTurn) return;
    const target = context.steerTarget;
    const messages = this.pendingSteers.splice(0);
    for (const message of messages) {
      void target.steer(this.steeringMessage(message)).catch(() => this.requeueFailedSteer(message));
      this.unconfirmedSteers.push(message);
    }
  }

  consumeRetainedMessages(): void {
    const ids = this.retainedMessageIds.splice(0);
    for (const messageId of ids) {
      this.updateMessageInPlace(messageId, 'delivered');
      this.acceptedStates.set(messageId, 'delivered');
      this.init.publish('message_delivery', { message_id: messageId, state: 'delivered' });
      this.init.transcript.setDeliveryState(messageId, 'delivered', { preserveDeliveredAt: true });
    }
  }

  finalizeUndeliveredMessages(userStopRequested: boolean): void {
    const finalState: MessageDeliveryState = userStopRequested ? 'retained' : 'superseded';
    const pending = [...this.unconfirmedSteers.splice(0), ...this.pendingSteers.splice(0), ...this.queue.splice(0)];
    for (const message of pending) this.recordState(message, finalState);
    for (const [messageId, state] of this.acceptedStates) {
      if (state !== 'queued') continue;
      this.acceptedStates.set(messageId, finalState);
      this.init.publish('message_delivery', { message_id: messageId, state: finalState });
      this.init.transcript.setDeliveryState(messageId, finalState);
    }
  }

  stopDeliveryStates(): Record<string, MessageDeliveryState> {
    const states: Record<string, MessageDeliveryState> = {};
    for (const [messageId, state] of this.acceptedStates) {
      states[messageId] = state === 'queued' ? 'retained' : state;
    }
    return states;
  }

  private chatMessage(message: QueuedUserMessage, state: MessageDeliveryState): SessionChatMessage {
    const chat: SessionChatMessage = {
      role: 'user',
      content: message.content,
      message_id: message.messageId,
      delivery_state: state,
    };
    if (message.contextAttachments.length > 0) chat.context_attachments = message.contextAttachments;
    return chat;
  }

  private moveMessageToDeliveryPoint(message: QueuedUserMessage, state: MessageDeliveryState): void {
    const index = this.init.messages.findIndex((entry) => entry.message_id === message.messageId);
    if (index >= 0) this.init.messages.splice(index, 1);
    this.init.messages.push(this.chatMessage(message, state));
  }

  private updateMessageInPlace(messageId: string, state: MessageDeliveryState): void {
    const existing = this.init.messages.find((entry) => entry.message_id === messageId);
    if (existing) existing.delivery_state = state;
  }

  private steeringMessage(message: QueuedUserMessage): string {
    return buildSteeringMessage(message.content, message.contextAttachments, this.init.attachmentContext);
  }

  private requeueFailedSteer(message: QueuedUserMessage): void {
    const index = this.unconfirmedSteers.indexOf(message);
    if (index >= 0) this.unconfirmedSteers.splice(index, 1);
    this.enqueue(message, true);
    this.recordState(message, 'queued');
  }
}
