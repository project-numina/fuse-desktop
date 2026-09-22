import { IconButton } from '@/components/ui/icon-button';

interface ComposerActionProps {
  sessionBusy: boolean;
  hasContent: boolean;
  canSend: boolean;
  stopPending: boolean;
  onSend: () => void;
  onStop: () => void;
}

/** One stable footer slot that morphs between stopping and sending. */
export function ComposerAction(props: ComposerActionProps) {
  return (
    <div className="chat-input-actions">
      {props.sessionBusy && !props.hasContent ? (
        <IconButton
          className="size-[34px]"
          variant="accent"
          radius="full"
          aria-label="End this session"
          title="End this session"
          disabled={props.stopPending}
          onClick={props.onStop}
        >
          <span className="stop-icon" />
        </IconButton>
      ) : (
        <IconButton
          className="size-[34px]"
          variant="accent"
          radius="full"
          aria-label="Send message"
          disabled={!props.canSend}
          onClick={props.onSend}
        >
          <svg className="send-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
          </svg>
        </IconButton>
      )}
    </div>
  );
}
