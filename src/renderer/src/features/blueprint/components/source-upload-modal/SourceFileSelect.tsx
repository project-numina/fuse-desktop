import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { SourceUploadWorkflow } from './use-source-upload-workflow';

function UploadFileIcon() {
  return (
    <svg
      className="h-8 w-8 text-muted-foreground"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

export function SourceFileSelect({ workflow }: { workflow: SourceUploadWorkflow }) {
  return (
    <>
      <div
        className={cn(
          'relative rounded-lg border border-dashed border-input px-6 py-8 text-center transition-colors hover:border-primary',
          workflow.isDragging && 'border-primary bg-accent',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          workflow.setIsDragging(true);
        }}
        onDragLeave={() => workflow.setIsDragging(false)}
        onDrop={workflow.onDrop}
      >
        <input
          id="source-upload-modal-input"
          ref={workflow.fileInputRef}
          type="file"
          accept=".tex,.md,.markdown,.pdf"
          className="hidden"
          onChange={workflow.onFileChange}
        />
        <label htmlFor="source-upload-modal-input" className="block cursor-pointer">
          <div className="flex flex-col items-center justify-center gap-2">
            <UploadFileIcon />
            <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
              Click or drag to upload a source
            </span>
            <span className="block text-xs text-muted-foreground">Supports .tex, .md, .markdown, and .pdf · Maximum 20 MB</span>
          </div>
        </label>
      </div>
      {workflow.error && <p className="mt-2 text-sm text-destructive">{workflow.error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" onClick={workflow.close}>Cancel</Button>
      </div>
    </>
  );
}
