import { useState, type Dispatch, type SetStateAction } from 'react';

import { uploadRepositorySource } from '@/lib/api';

import { MAX_SOURCE_UPLOAD_BYTES, SOURCE_UPLOAD_TOO_LARGE_MESSAGE, validateSourceName } from './helpers';
import type { SourceUploadModalProps } from './types';
import { useSourceUploadDraft } from './use-source-upload-draft';
import type { SourceUploadDraft } from './use-source-upload-draft';

interface WorkflowOptions extends Required<Pick<SourceUploadModalProps, 'owner' | 'repository' | 'blueprintId' | 'mode' | 'existingNames'>> {
  open: boolean;
  onOpenChange: SourceUploadModalProps['onOpenChange'];
  onUploaded: SourceUploadModalProps['onUploaded'];
}

async function submitSource(
  options: WorkflowOptions,
  draft: SourceUploadDraft,
  writeMode: boolean,
  canSubmit: boolean,
  setIsUploading: Dispatch<SetStateAction<boolean>>,
) {
  if (!canSubmit) return;
  const file = writeMode
    ? new File([draft.writeContentRef.current], 'source.tex', { type: 'text/plain' })
    : draft.pendingFile;
  if (!file) return;
  if (file.size > MAX_SOURCE_UPLOAD_BYTES) {
    draft.setError(SOURCE_UPLOAD_TOO_LARGE_MESSAGE);
    return;
  }
  draft.setError(null);
  setIsUploading(true);
  try {
    const source = await uploadRepositorySource(options.owner, options.repository, file, {
      displayName: draft.uploadName,
      projectScoped: draft.projectScoped && !!options.blueprintId,
      blueprintId: options.blueprintId,
    });
    options.onUploaded(source);
    options.onOpenChange(false);
  } catch (error) {
    draft.setError(error instanceof Error && error.message
      ? error.message
      : 'Could not upload source. Try again.');
  } finally {
    setIsUploading(false);
  }
}

export function useSourceUploadWorkflow(options: WorkflowOptions) {
  const draft = useSourceUploadDraft(options.open, options.blueprintId);
  const [isUploading, setIsUploading] = useState(false);
  const writeMode = options.mode === 'write';
  const name = validateSourceName(draft.uploadName, options.existingNames);
  const canSubmit = !isUploading
    && !!name.trimmedName
    && !name.collision
    && !name.tooLong
    && (writeMode ? draft.hasWriteContent : !!draft.pendingFile);

  const close = () => { if (!isUploading) options.onOpenChange(false); };
  const submit = () => submitSource(options, draft, writeMode, canSubmit, setIsUploading);
  return { ...draft, ...name, writeMode, isUploading, canSubmit, close, submit };
}

export type SourceUploadWorkflow = ReturnType<typeof useSourceUploadWorkflow>;
