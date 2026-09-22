import { attachmentRangeLabel } from '@/features/chat/components/composer/ChatComposer';
import type { ChatContextAttachment } from '@/features/chat/state/types';

interface ContextAttachmentChipProps {
  attachment: ChatContextAttachment;
  onOpen?: (attachment: ChatContextAttachment) => void;
}

/** Compact source reference shown below a user message. */
export default function ContextAttachmentChip({
  attachment,
  onOpen,
}: ContextAttachmentChipProps) {
  const range = attachmentRangeLabel(attachment);
  const content = (
    <>
      <svg
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground opacity-70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="min-w-0 truncate font-medium">
        {attachment.display_name || attachment.source_id || attachment.repo_path}
      </span>
      {range ? (
        <span className="shrink-0 font-semibold text-muted-foreground">
          · {range}
        </span>
      ) : null}
    </>
  );
  const className = 'inline-flex min-w-0 max-w-[70%] items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-0.5 text-[0.6875rem] text-foreground/70';
  if (
    attachment.attachment_kind !== 'backend_source'
    || !attachment.source_id
    || !onOpen
  ) {
    return <span className={className}>{content}</span>;
  }
  return (
    <button
      type="button"
      className={`${className} cursor-pointer transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
      onClick={() => onOpen(attachment)}
    >
      {content}
    </button>
  );
}
