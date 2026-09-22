import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

import type { RepositoryBlueprintFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface SourceFilePickerDialogProps {
  open: boolean;
  files: RepositoryBlueprintFile[];
  selectedPath: string | null;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  description: ReactNode;
  savingLabel: string;
  errorClassName?: string;
  itemClassName?: string;
  selectedIndicator?: ReactNode;
  footerClassName?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  onConfirm: () => void;
}

function SourceFilePickerDialog({
  open,
  files,
  selectedPath,
  loading = false,
  saving = false,
  error,
  description,
  savingLabel,
  errorClassName,
  itemClassName,
  selectedIndicator,
  footerClassName,
  onOpenChange,
  onSelect,
  onConfirm,
}: SourceFilePickerDialogProps) {
  const [filter, setFilter] = useState('');
  const filteredFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return files;
    return files.filter(
      (file) =>
        file.path.toLowerCase().includes(query) || file.name.toLowerCase().includes(query),
    );
  }, [files, filter]);

  useEffect(() => {
    if (open) setFilter('');
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setFilter('');
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-lg text-left sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a blueprint source</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {loading ? (
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
              Loading .tex files…
            </p>
          ) : error && files.length === 0 ? (
            <p className={cn('m-0 text-xs text-destructive', errorClassName)}>{error}</p>
          ) : files.length === 0 ? (
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
              No leanblueprint .tex files found in this repository.
            </p>
          ) : (
            <>
              <Input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search .tex files…"
                autoComplete="off"
                spellCheck={false}
              />
              <div
                role="radiogroup"
                aria-label="Existing .tex files"
                className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
              >
                {filteredFiles.length === 0 ? (
                  <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                    No files match &quot;{filter}&quot;.
                  </p>
                ) : (
                  filteredFiles.map((file) => {
                    const selected = selectedPath === file.path;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onSelect(file.path)}
                        className={cn(
                          'group flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted',
                          selected && 'bg-muted',
                          itemClassName,
                        )}
                      >
                        <span className="flex min-w-0 flex-col items-start gap-0.5">
                          <span
                            className={cn(
                              'text-sm font-medium text-foreground transition-colors group-hover:text-primary',
                              selected && 'text-primary',
                            )}
                          >
                            {file.name}
                          </span>
                          <code className="truncate font-mono text-xs text-muted-foreground">
                            {file.path}
                          </code>
                        </span>
                        {selected && (
                          selectedIndicator ?? (
                            <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-primary" />
                          )
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {error && files.length > 0 && (
            <p className={cn('m-0 text-xs text-destructive', errorClassName)}>{error}</p>
          )}
        </div>

        <DialogFooter className={footerClassName}>
          <Button variant="ghost" disabled={saving} onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {files.length > 0 && (
            <Button
              variant="outline"
              disabled={!selectedPath || saving || loading}
              onClick={onConfirm}
            >
              {saving ? savingLabel : 'Use this file'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SourceFilePickerDialog;
export type { SourceFilePickerDialogProps };
