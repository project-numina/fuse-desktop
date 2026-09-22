import { LatexEditor } from '@/components/editor/LatexEditor';
import { Button } from '@/components/ui/button';

import { SourceNameField } from './SourceNameField';
import { SourceScopeToggle } from './SourceScopeToggle';
import type { SourceUploadWorkflow } from './use-source-upload-workflow';

interface WriteSourceFormProps {
  blueprintId: string;
  workflow: SourceUploadWorkflow;
}

export function WriteSourceForm({ blueprintId, workflow }: WriteSourceFormProps) {
  return (
    <>
      <SourceNameField
        value={workflow.uploadName}
        trimmedName={workflow.trimmedName}
        collision={workflow.collision}
        tooLong={workflow.tooLong}
        onChange={workflow.setUploadName}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">Source (LaTeX)</span>
        <div className="h-[min(48vh,360px)]">
          <LatexEditor
            value={workflow.writeContentRef.current}
            onChange={workflow.onWriteContentChange}
            fileName="source.tex"
            placeholder="Paste or write your LaTeX source here…"
            lineWrapping
            fillHeight
          />
        </div>
      </div>
      <SourceScopeToggle
        blueprintId={blueprintId}
        projectScoped={workflow.projectScoped}
        onChange={workflow.setProjectScoped}
      />
      {workflow.error && <p className="mt-2 text-sm text-destructive">{workflow.error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" disabled={workflow.isUploading} onClick={workflow.close}>
          Cancel
        </Button>
        <Button disabled={!workflow.canSubmit} onClick={() => void workflow.submit()}>
          {workflow.isUploading ? 'Adding…' : 'Add source'}
        </Button>
      </div>
    </>
  );
}
