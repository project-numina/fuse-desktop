import { useRef } from 'react';
import { ChevronRight, Folder, PenLine, Upload } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AddSourceView } from './model';

interface SourceChooserDialogProps {
  open: boolean;
  onClose: () => void;
  onChoose: (view: AddSourceView) => void;
}

export function SourceChooserDialog({ open, onClose, onChoose }: SourceChooserDialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent ref={contentRef} initialFocus={contentRef} className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>Choose how you want to add source material to this blueprint.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <SourceTypeChoice
            icon={<Upload className="size-4" />}
            title="Upload a source"
            description="Add a .tex, .md, or .pdf file from your computer."
            onClick={() => onChoose('upload')}
          />
          <SourceTypeChoice
            icon={<PenLine className="size-4" />}
            title="Write a source"
            description="Paste or type a LaTeX source."
            onClick={() => onChoose('write')}
          />
          <SourceTypeChoice
            icon={<Folder className="size-4" />}
            title="Choose from repository"
            description="Select an existing file from this folder."
            onClick={() => onChoose('repository')}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SourceTypeChoiceProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function SourceTypeChoice({ icon, title, description, onClick }: SourceTypeChoiceProps) {
  return (
    <button
      type="button"
      className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-background p-3.5 text-left transition-colors hover:border-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={onClick}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground group-hover:text-primary">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
  );
}
