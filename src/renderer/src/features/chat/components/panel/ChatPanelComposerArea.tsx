import type { RefObject } from 'react';

import ChatComposer, {
  type ChatComposerHandle,
} from '@/features/chat/components/composer/ChatComposer';
import PermissionPromptCard from '@/features/chat/components/PermissionPromptCard';
import type {
  ChatContextAttachment,
  PermissionPrompt,
} from '@/features/chat/state/types';
import type { PermissionDecisionBody, RepositorySource } from '@/lib/api';

interface ChatPanelComposerAreaProps {
  addDraftAttachment: (attachment: ChatContextAttachment) => void;
  availableSources?: RepositorySource[];
  blueprintId: string;
  canSendMessage: boolean;
  composerHasContent: boolean;
  composerPlaceholder: string;
  composerRef: RefObject<ChatComposerHandle | null>;
  draftAttachments: ChatContextAttachment[];
  expanded: boolean;
  handleComposerChange: (value: string) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
  hasMessages: boolean;
  input: string;
  onPermissionDecision: (
    requestId: string,
    decision: PermissionDecisionBody,
  ) => Promise<void>;
  onSourceUploaded?: (source: RepositorySource) => void;
  owner: string;
  readonly: boolean;
  readonlyMessage: string;
  removeDraftAttachment: (attachment: ChatContextAttachment) => void;
  repository: string;
  sessionBusy: boolean;
  stopPending: boolean;
  suggestedMessage: string;
  unplacedPrompts: PermissionPrompt[];
}

type ComposerProps = Pick<ChatPanelComposerAreaProps,
  | 'addDraftAttachment'
  | 'availableSources'
  | 'blueprintId'
  | 'canSendMessage'
  | 'composerHasContent'
  | 'composerRef'
  | 'draftAttachments'
  | 'handleComposerChange'
  | 'handleSend'
  | 'handleStop'
  | 'input'
  | 'onSourceUploaded'
  | 'owner'
  | 'removeDraftAttachment'
  | 'repository'
  | 'stopPending'
> & {
  placeholder: string;
  sessionBusy: boolean;
};

function ConfiguredComposer({
  addDraftAttachment,
  availableSources,
  blueprintId,
  canSendMessage,
  composerHasContent,
  composerRef,
  draftAttachments,
  handleComposerChange,
  handleSend,
  handleStop,
  input,
  onSourceUploaded,
  owner,
  placeholder,
  removeDraftAttachment,
  repository,
  sessionBusy,
  stopPending,
}: ComposerProps) {
  return (
    <ChatComposer
      ref={composerRef}
      value={input}
      onChange={handleComposerChange}
      placeholder={placeholder}
      placeholderCompletable={!sessionBusy}
      hasContent={composerHasContent}
      canSend={canSendMessage}
      sessionBusy={sessionBusy}
      stopPending={stopPending}
      onSend={handleSend}
      onStop={handleStop}
      owner={owner}
      repository={repository}
      blueprintId={blueprintId}
      availableSources={availableSources}
      attachments={draftAttachments}
      onAddAttachment={addDraftAttachment}
      onRemoveAttachment={removeDraftAttachment}
      onSourceUploaded={onSourceUploaded}
    />
  );
}

function EmptyChat(props: ChatPanelComposerAreaProps) {
  return (
    <div className="empty-state">
      {props.readonly ? (
        <div className="chat-readonly-notice">{props.readonlyMessage}</div>
      ) : (
        <>
          <div className="empty-prompt">What should we do next?</div>
          <ConfiguredComposer
            {...props}
            placeholder={props.suggestedMessage}
            sessionBusy={false}
          />
        </>
      )}
    </div>
  );
}

function PromptCards({
  prompts,
  onRespond,
}: {
  prompts: PermissionPrompt[];
  onRespond: ChatPanelComposerAreaProps['onPermissionDecision'];
}) {
  return prompts.map((prompt) => (
    <PermissionPromptCard
      key={`unplaced-permission-${prompt.request_id}`}
      prompt={prompt}
      onRespond={onRespond}
    />
  ));
}

export default function ChatPanelComposerArea(
  props: ChatPanelComposerAreaProps,
) {
  if (!props.hasMessages) return <EmptyChat {...props} />;
  return (
    <div className="chat-input-area" inert={props.expanded ? true : undefined}>
      <PromptCards
        prompts={props.unplacedPrompts}
        onRespond={props.onPermissionDecision}
      />
      {props.readonly ? (
        <div className="chat-readonly-notice">{props.readonlyMessage}</div>
      ) : (
        <ConfiguredComposer
          {...props}
          placeholder={props.composerPlaceholder}
          sessionBusy={props.sessionBusy}
        />
      )}
    </div>
  );
}
