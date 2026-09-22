import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { NameSourceForm } from './source-upload-modal/NameSourceForm';
import { SourceFileSelect } from './source-upload-modal/SourceFileSelect';
import type { SourceUploadModalProps } from './source-upload-modal/types';
import { useSourceUploadWorkflow } from './source-upload-modal/use-source-upload-workflow';
import type { SourceUploadWorkflow } from './source-upload-modal/use-source-upload-workflow';
import { useWriteModePageBlur } from './source-upload-modal/use-write-mode-page-blur';
import { WriteSourceForm } from './source-upload-modal/WriteSourceForm';

export type { SourceUploadModalProps } from './source-upload-modal/types';

interface SourceUploadDialogProps {
  open: boolean;
  blueprintId: string;
  onOpenChange: (open: boolean) => void;
  removePageBlur: () => void;
  workflow: SourceUploadWorkflow;
}

function SourceUploadDialog(props: SourceUploadDialogProps) {
  const { open, blueprintId, onOpenChange, removePageBlur, workflow } = props;
  const title = workflow.writeMode
    ? 'Write source'
    : workflow.step === 'select' ? 'Add source' : 'Name source';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !workflow.isUploading) onOpenChange(false);
      }}
      onOpenChangeComplete={(next) => { if (!next) removePageBlur(); }}
    >
      <DialogContent
        className={cn('sm:max-w-md', workflow.writeMode && 'sm:max-w-[720px]')}
        overlayClassName={workflow.writeMode
          ? 'supports-backdrop-filter:backdrop-blur-none'
          : undefined}
      >
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {workflow.writeMode ? (
          <WriteSourceForm blueprintId={blueprintId} workflow={workflow} />
        ) : workflow.step === 'select' ? (
          <SourceFileSelect workflow={workflow} />
        ) : (
          <NameSourceForm blueprintId={blueprintId} workflow={workflow} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SourceUploadModal({
  open,
  owner = '',
  repository = '',
  blueprintId = '',
  mode = 'upload',
  existingNames = [],
  onOpenChange,
  onUploaded,
}: SourceUploadModalProps) {
  const workflow = useSourceUploadWorkflow({
    open,
    owner,
    repository,
    blueprintId,
    mode,
    existingNames,
    onOpenChange,
    onUploaded,
  });
  const removePageBlur = useWriteModePageBlur(open, workflow.writeMode);
  return (
    <SourceUploadDialog
      open={open}
      blueprintId={blueprintId}
      onOpenChange={onOpenChange}
      removePageBlur={removePageBlur}
      workflow={workflow}
    />
  );
}

export default SourceUploadModal;
