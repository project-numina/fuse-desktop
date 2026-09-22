import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  fileIsSupported,
  MAX_SOURCE_UPLOAD_BYTES,
  SOURCE_UPLOAD_TOO_LARGE_MESSAGE,
} from './helpers';
import type { SourceUploadStep } from './types';

interface DraftState {
  step: SourceUploadStep;
  pendingFile: File | null;
  uploadName: string;
  projectScoped: boolean;
  hasWriteContent: boolean;
  isDragging: boolean;
  error: string | null;
}

type SetDraft = Dispatch<SetStateAction<DraftState>>;
type PatchDraft = (patch: Partial<DraftState>) => void;

function initialDraft(projectScoped: boolean): DraftState {
  return {
    step: 'select', pendingFile: null, uploadName: '', projectScoped,
    hasWriteContent: false, isDragging: false, error: null,
  };
}

function selectFile(file: File, patch: PatchDraft) {
  if (!fileIsSupported(file)) {
    patch({ error: 'Upload a .tex, .md, .markdown, or .pdf file.' });
    return;
  }
  if (file.size > MAX_SOURCE_UPLOAD_BYTES) {
    patch({ pendingFile: null, error: SOURCE_UPLOAD_TOO_LARGE_MESSAGE });
    return;
  }
  patch({ pendingFile: file, uploadName: file.name, step: 'name', error: null });
}

function updateWriteContent(ref: RefObject<string>, setDraft: SetDraft, next: string) {
  ref.current = next;
  const hasWriteContent = /\S/.test(next);
  setDraft((current) => current.hasWriteContent === hasWriteContent
    ? current
    : { ...current, hasWriteContent });
}

export function useSourceUploadDraft(open: boolean, blueprintId: string) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const writeContentRef = useRef('');
  const blueprintIdRef = useRef(blueprintId);
  blueprintIdRef.current = blueprintId;
  const [draft, setDraft] = useState(() => initialDraft(false));
  const patch: PatchDraft = (next) => setDraft((current) => ({ ...current, ...next }));

  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft(!!blueprintIdRef.current));
    if (fileInputRef.current) fileInputRef.current.value = '';
    return () => { writeContentRef.current = ''; };
  }, [open]);

  const back = () => {
    patch({ step: 'select', pendingFile: null, uploadName: '', error: null });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) selectFile(file, patch);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    patch({ isDragging: false });
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file, patch);
  };

  return {
    ...draft, fileInputRef, writeContentRef, back, onFileChange, onDrop,
    setUploadName: (uploadName: string) => patch({ uploadName }),
    setProjectScoped: (projectScoped: boolean) => patch({ projectScoped }),
    setIsDragging: (isDragging: boolean) => patch({ isDragging }),
    setError: (error: string | null) => patch({ error }),
    onWriteContentChange: (next: string) => updateWriteContent(writeContentRef, setDraft, next),
  };
}

export type SourceUploadDraft = ReturnType<typeof useSourceUploadDraft>;
