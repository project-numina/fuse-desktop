import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import AddSourceDialog from '@/features/blueprint/components/AddSourceDialog';
import AttachmentPicker from '@/features/chat/components/AttachmentPicker';
import type { ChatContextAttachment } from '@/features/chat/state/types';
import type { RepositoryFileEntry, RepositorySource } from '@/lib/api';

export function attachmentKey(attachment: ChatContextAttachment): string {
  return [
    attachment.id || '',
    attachment.attachment_kind,
    attachment.source_id || '',
    attachment.repo_path || '',
    attachment.artifact_kind || '',
    JSON.stringify(attachment.selection || { kind: 'entire_file' }),
  ].join(':');
}

export function attachmentRangeLabel(attachment: ChatContextAttachment): string {
  const selection = attachment.selection;
  if (selection?.kind === 'line_range') {
    return selection.start_line === selection.end_line
      ? `line ${selection.start_line}`
      : `lines ${selection.start_line}-${selection.end_line}`;
  }
  if (selection?.kind === 'page_range') {
    return selection.start_page === selection.end_page
      ? `page ${selection.start_page}`
      : `pages ${selection.start_page}-${selection.end_page}`;
  }
  return '';
}

interface AttachmentListProps {
  attachments: ChatContextAttachment[];
  onRemove?: (attachment: ChatContextAttachment) => void;
}

export function ComposerAttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <ComposerAttachmentChip
          key={attachmentKey(attachment)}
          attachment={attachment}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function ComposerAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatContextAttachment;
  onRemove?: (attachment: ChatContextAttachment) => void;
}) {
  const range = attachmentRangeLabel(attachment);
  return (
    <div className="inline-flex min-h-6 min-w-0 max-w-[calc(50%_-_0.25rem)] items-center gap-1.5 rounded-full bg-muted/70 py-0.5 pl-2.5 pr-1.5 text-xs text-foreground/70">
      <span className="min-w-0 truncate font-medium">
        {attachment.display_name || attachment.source_id || attachment.repo_path}
      </span>
      {range ? <span className="shrink-0 text-muted-foreground">· {range}</span> : null}
      <button
        type="button"
        aria-label={`Remove ${attachment.display_name || 'attachment'}`}
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => onRemove?.(attachment)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-2.5">
          <path strokeLinecap="round" d="M4.5 4.5l7 7m0-7l-7 7" />
        </svg>
      </button>
    </div>
  );
}

interface AttachmentControlsProps {
  owner: string;
  repository: string;
  blueprintId: string;
  availableSources?: RepositorySource[];
  attachments: ChatContextAttachment[];
  stopPending: boolean;
  focusInput: () => void;
  onAddAttachment?: (attachment: ChatContextAttachment) => void;
  onSourceUploaded?: (source: RepositorySource) => void;
}

export function ComposerAttachmentControls(props: AttachmentControlsProps) {
  const controls = useAttachmentControls(props);
  return (
    <>
      <AttachmentButton
        open={controls.pickerOpen}
        stopPending={props.stopPending}
        onToggle={controls.togglePicker}
      />
      <AttachmentPicker
        open={controls.pickerOpen}
        owner={props.owner}
        repository={props.repository}
        blueprintId={props.blueprintId}
        sources={props.availableSources}
        selectedSourceIds={controls.selectedSourceIds}
        onClose={controls.closePicker}
        onSelectSource={controls.selectSource}
        onRequestAddSource={controls.requestAddSource}
      />
      <AddSourceDialog
        open={controls.dialogOpen}
        owner={props.owner}
        repository={props.repository}
        blueprintId={props.blueprintId}
        existingNames={controls.existingSourceNames}
        excludedRepoPaths={controls.selectedRepoPaths}
        onOpenChange={controls.setDialogOpen}
        onUploaded={controls.handleUploaded}
        onSelectRepoFile={controls.selectRepoFile}
      />
    </>
  );
}

function AttachmentButton({
  open,
  stopPending,
  onToggle,
}: {
  open: boolean;
  stopPending: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Attach source"
        aria-expanded={open}
        title={open ? undefined : 'Attach source'}
        className="flex size-[34px] cursor-pointer items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l6.8-6.8a3.4 3.4 0 014.8 4.8l-8.4 8.4a5 5 0 01-7.1-7.1l8.6-8.6" />
        </svg>
      </button>
      {stopPending ? <span className="chat-run-status" aria-live="polite">Stopping…</span> : null}
    </div>
  );
}

function useAttachmentControls(props: AttachmentControlsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const selection = useAttachmentSelection(props);
  const actions = useAttachmentActions(props, setPickerOpen, setDialogOpen);
  return {
    pickerOpen, dialogOpen, setDialogOpen,
    ...selection,
    ...actions,
  };
}

function useAttachmentSelection(props: AttachmentControlsProps) {
  const selectedSourceIds = useMemo(
    () => compact(props.attachments.map((attachment) => attachment.source_id)),
    [props.attachments],
  );
  const selectedRepoPaths = useMemo(
    () => compact(props.attachments.map((attachment) => attachment.repo_path)),
    [props.attachments],
  );
  const existingSourceNames = useMemo(
    () => props.availableSources?.map((source) => source.display_name),
    [props.availableSources],
  );
  return { selectedSourceIds, selectedRepoPaths, existingSourceNames };
}

function useAttachmentActions(
  props: AttachmentControlsProps,
  setPickerOpen: Dispatch<SetStateAction<boolean>>,
  setDialogOpen: Dispatch<SetStateAction<boolean>>,
) {
  const closePicker = () => setPickerOpen(false);
  const togglePicker = () => setPickerOpen((open) => !open);
  const selectSource = (source: RepositorySource) => {
    props.onAddAttachment?.(sourceAttachment(source));
    closePicker();
    props.focusInput();
  };
  const selectRepoFile = (file: RepositoryFileEntry) => {
    props.onAddAttachment?.(repoFileAttachment(file));
    closePicker();
    props.focusInput();
  };
  const requestAddSource = () => {
    closePicker();
    setDialogOpen(true);
  };
  const handleUploaded = (source: RepositorySource) => {
    selectSource(source);
    props.onSourceUploaded?.(source);
  };
  return {
    closePicker, togglePicker, selectSource, selectRepoFile,
    requestAddSource, handleUploaded,
  };
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function sourceAttachment(source: RepositorySource): ChatContextAttachment {
  return {
    attachment_kind: 'backend_source',
    source_id: source.id,
    artifact_kind: null,
    display_name: source.display_name,
    selection: { kind: 'entire_file' },
  };
}

function repoFileAttachment(file: RepositoryFileEntry): ChatContextAttachment {
  return {
    attachment_kind: 'repo_file',
    source_id: null,
    artifact_kind: null,
    repo_path: file.path,
    display_name: file.path,
    selection: { kind: 'entire_file' },
  };
}
