import { Button } from '@/components/ui/button';

import { SelectedSourceFile } from './SelectedSourceFile';
import { SourceNameField } from './SourceNameField';
import { SourceScopeToggle } from './SourceScopeToggle';
import type { SourceUploadWorkflow } from './use-source-upload-workflow';

interface NameSourceFormProps {
  blueprintId: string;
  workflow: SourceUploadWorkflow;
}

export function NameSourceForm({ blueprintId, workflow }: NameSourceFormProps) {
  return (
    <>
      {workflow.pendingFile && <SelectedSourceFile file={workflow.pendingFile} />}
      <SourceNameField
        value={workflow.uploadName}
        trimmedName={workflow.trimmedName}
        collision={workflow.collision}
        tooLong={workflow.tooLong}
        error={workflow.error}
        onChange={workflow.setUploadName}
        onSubmit={() => void workflow.submit()}
      />
      <SourceScopeToggle
        blueprintId={blueprintId}
        projectScoped={workflow.projectScoped}
        onChange={workflow.setProjectScoped}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" disabled={workflow.isUploading} onClick={workflow.back}>
          Back
        </Button>
        <Button disabled={!workflow.canSubmit} onClick={() => void workflow.submit()}>
          {workflow.isUploading ? 'Adding…' : 'Add source'}
        </Button>
      </div>
    </>
  );
}
