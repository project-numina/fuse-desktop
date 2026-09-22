import { attachmentKey } from '@/features/chat/components/composer/ChatComposer';
import ContextAttachmentChip from '@/features/chat/components/ContextAttachmentChip';
import UserMessageText from '@/features/chat/components/UserMessageText';
import type {
  ChatContextAttachment,
  ChatMessage,
} from '@/features/chat/state/types';

/**
 * Messages the user has sent that the agent has not been given yet (ADR 044).
 *
 * Rendered at the end of the transcript, below the thinking they arrived
 * during, and styled as ordinary user messages because that is what they are.
 * The dashed border shows that the message is still waiting, so a correction
 * sent mid-run is visibly queued rather than appearing to vanish.
 */

export interface PendingMessagesProps {
  /** Undelivered user messages, in send order. */
  messages: ChatMessage[];
  /** Whether this conversation still has a live backend session. */
  sessionLive: boolean;
  /** Opens a persisted source attachment from a pending user message. */
  onOpenContextAttachment?: (attachment: ChatContextAttachment) => void;
}

const BORDER_EDGES = [
  { side: 'top', x1: '0', y1: '0.5', x2: '100%', y2: '0.5' },
  { side: 'right', x1: '0.5', y1: '0', x2: '0.5', y2: '100%' },
  { side: 'bottom', x1: '100%', y1: '0.5', x2: '0', y2: '0.5' },
  { side: 'left', x1: '0.5', y1: '100%', x2: '0.5', y2: '0' },
] as const;

const BORDER_CORNERS = [
  { corner: 'top-left', path: 'M 0.5 20 A 19.5 19.5 0 0 1 20 0.5' },
  { corner: 'top-right', path: 'M 0 0.5 A 19.5 19.5 0 0 1 19.5 20' },
  { corner: 'bottom-right', path: 'M 19.5 0 A 19.5 19.5 0 0 1 0 19.5' },
  { corner: 'bottom-left', path: 'M 20 19.5 A 19.5 19.5 0 0 1 0.5 0' },
] as const;

function PendingMessageBorder() {
  return (
    <span className="pending-message-border" aria-hidden="true">
      {BORDER_EDGES.map(({ side, ...line }) => (
        <svg
          className={`pending-message-border-segment pending-message-border-${side}`}
          key={side}
          focusable="false"
        >
          <line className="pending-message-border-stroke" {...line} />
        </svg>
      ))}
      {BORDER_CORNERS.map(({ corner, path }) => (
        <svg
          className={`pending-message-border-segment pending-message-border-${corner}`}
          key={corner}
          viewBox="0 0 20 20"
          focusable="false"
        >
          <path className="pending-message-border-stroke pending-message-border-curve" d={path} />
        </svg>
      ))}
    </span>
  );
}

export default function PendingMessages({
  messages,
  sessionLive,
  onOpenContextAttachment,
}: PendingMessagesProps) {
  if (messages.length === 0) return null;

  return (
    <div className="pending-messages" aria-live="polite">
      {messages.map((message, index) => {
        // Once steered the message is inside the running turn, so it is just
        // a message: no note explaining when it will arrive, and no override,
        // which would only discard in-flight work to no end.
        const stillWaiting = message.deliveryState === 'queued' && sessionLive;
        const superseded = message.deliveryState === 'superseded'
          || (message.deliveryState === 'queued' && !sessionLive);
        return (
          <div
            className="chat-turn-user-row pending-message"
            data-message-role="user"
            key={message.messageId ?? `optimistic-${index}`}
          >
            <div className="pending-message-stack">
              <div className="pending-message-row">
                <div className="pending-message-content">
                  <UserMessageText
                    text={message.text}
                    bubbleClassName={stillWaiting ? 'pending-message-bubble' : ''}
                  >
                    {stillWaiting ? <PendingMessageBorder /> : null}
                  </UserMessageText>
                  {message.contextAttachments?.map((attachment) => (
                    <ContextAttachmentChip
                      key={attachmentKey(attachment)}
                      attachment={attachment}
                      onOpen={onOpenContextAttachment}
                    />
                  ))}
                </div>
              </div>
              {stillWaiting ? (
                <span className="sr-only">
                  Waiting to be delivered to the agent
                </span>
              ) : superseded ? (
                <p className="pending-message-status">
                  Not delivered to the agent
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
