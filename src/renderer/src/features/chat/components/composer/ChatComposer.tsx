import { forwardRef } from 'react';

import { ComposerAction } from '@/features/chat/components/composer/chat-composer-action';
import {
  ComposerAttachmentControls,
  ComposerAttachmentList,
} from '@/features/chat/components/composer/chat-composer-attachments';
import {
  ComposerInput,
  useComposerInput,
  type ChatComposerHandle,
} from '@/features/chat/components/composer/chat-composer-input';
import { ChatComposerStyles } from '@/features/chat/components/composer/chat-composer-styles';
import type { ChatContextAttachment } from '@/features/chat/state/types';
import type { RepositorySource } from '@/lib/api';

export { attachmentKey, attachmentRangeLabel } from '@/features/chat/components/composer/chat-composer-attachments';
export type { ChatComposerHandle } from '@/features/chat/components/composer/chat-composer-input';

/** The parent-controlled message composer with attachments and send/stop. */
interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Whether Tab promotes the empty-state hint to editable message text. */
  placeholderCompletable?: boolean;
  canSend: boolean;
  /** Defaults to non-whitespace text for callers without attachments. */
  hasContent?: boolean;
  sessionBusy: boolean;
  /** Stop is requested or draining; latch the control until the session ends. */
  stopPending?: boolean;
  onSend: () => void;
  onStop: () => void;
  owner?: string;
  repository?: string;
  blueprintId?: string;
  availableSources?: RepositorySource[];
  attachments?: ChatContextAttachment[];
  onAddAttachment?: (attachment: ChatContextAttachment) => void;
  onRemoveAttachment?: (attachment: ChatContextAttachment) => void;
  onSourceUploaded?: (source: RepositorySource) => void;
}

const EMPTY_ATTACHMENTS: ChatContextAttachment[] = [];

/** Shared sizing for text controls that sit in the chat composer footer. */
export const CHAT_FOOTER_CONTROL_SIZE_CLASS =
  'min-h-[34px] rounded-full px-4 text-[0.8125rem] font-semibold';

/** Composer-style outlined control, shared with adjacent chat decisions. */
export const CHAT_FOOTER_OUTLINE_CONTROL_CLASS =
  `${CHAT_FOOTER_CONTROL_SIZE_CLASS} border-[color:var(--numina-border-light)] `
  + 'bg-transparent text-muted-foreground hover:border-[color:var(--numina-border)] '
  + 'hover:bg-transparent hover:text-foreground focus-visible:border-[color:var(--numina-border-strong)] '
  + 'focus-visible:ring-0 data-popup-open:border-[color:var(--numina-border)] '
  + 'data-popup-open:text-foreground';

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(props, ref) {
    const placeholderCompletable = props.placeholderCompletable ?? true;
    const attachments = props.attachments ?? EMPTY_ATTACHMENTS;
    const input = useComposerInput({
      value: props.value,
      placeholder: props.placeholder,
      placeholderCompletable,
      canSend: props.canSend,
      onChange: props.onChange,
      onSend: props.onSend,
      forwardedRef: ref,
    });
    const hasContent = props.hasContent ?? Boolean(props.value.trim());
    return <ChatComposerView {...{ props, input, attachments, placeholderCompletable, hasContent }} />;
  },
);

interface ChatComposerViewProps {
  props: ChatComposerProps;
  input: ReturnType<typeof useComposerInput>;
  attachments: ChatContextAttachment[];
  placeholderCompletable: boolean;
  hasContent: boolean;
}

/** Declarative layout for the independently stateful composer seams. */
function ChatComposerView({
  props,
  input,
  attachments,
  placeholderCompletable,
  hasContent,
}: ChatComposerViewProps) {
  return (
    <div className="chat-input-wrap">
      <ComposerAttachmentList attachments={attachments} onRemove={props.onRemoveAttachment} />
      <ComposerInput
        value={props.value}
        placeholder={props.placeholder}
        placeholderCompletable={placeholderCompletable}
        model={input}
        onChange={props.onChange}
      />
      <div className="chat-input-footer">
        <ComposerAttachmentControls
          owner={props.owner ?? ''}
          repository={props.repository ?? ''}
          blueprintId={props.blueprintId ?? ''}
          availableSources={props.availableSources}
          attachments={attachments}
          stopPending={props.stopPending ?? false}
          focusInput={input.focus}
          onAddAttachment={props.onAddAttachment}
          onSourceUploaded={props.onSourceUploaded}
        />
        <ComposerAction
          sessionBusy={props.sessionBusy}
          hasContent={hasContent}
          canSend={props.canSend}
          stopPending={props.stopPending ?? false}
          onSend={props.onSend}
          onStop={props.onStop}
        />
      </div>
      <ChatComposerStyles />
    </div>
  );
}

export default ChatComposer;
