import { useCallback, useEffect, useState } from 'react';

import SourceUploadModal from '@/features/blueprint/components/SourceUploadModal';
import type { RepositoryFileEntry, RepositorySource } from '@/lib/api';
import { RepositorySourceBrowserDialog } from './add-source-dialog/RepositorySourceBrowserDialog';
import { SourceChooserDialog } from './add-source-dialog/SourceChooserDialog';
import type { AddSourceView, RepositoryAction } from './add-source-dialog/model';
import { useRepositorySourceBrowser } from './add-source-dialog/use-repository-source-browser';

const EMPTY_STRINGS: string[] = [];

export interface AddSourceDialogProps {
  open: boolean;
  owner?: string;
  repository?: string;
  blueprintId?: string;
  existingNames?: string[];
  excludedRepoPaths?: string[];
  repositoryAction?: RepositoryAction;
  onOpenChange: (open: boolean) => void;
  onUploaded: (source: RepositorySource) => void;
  onSelectRepoFile: (file: RepositoryFileEntry) => void | Promise<void>;
}

function AddSourceDialog({
  open,
  owner = '',
  repository = '',
  blueprintId = '',
  existingNames = EMPTY_STRINGS,
  excludedRepoPaths = EMPTY_STRINGS,
  repositoryAction = 'attach',
  onOpenChange,
  onUploaded,
  onSelectRepoFile,
}: AddSourceDialogProps) {
  const [view, setView] = useState<AddSourceView>('choose');
  useEffect(() => {
    if (open) setView('choose');
  }, [open]);
  const close = useCallback(() => {
    setView('choose');
    onOpenChange(false);
  }, [onOpenChange]);
  const browser = useRepositorySourceBrowser({
    active: open && view === 'repository',
    open,
    owner,
    repository,
    blueprintId,
    excludedPaths: excludedRepoPaths,
    action: repositoryAction,
    onSelect: onSelectRepoFile,
    onComplete: close,
  });
  const resetBrowser = browser.reset;
  const choose = useCallback((nextView: AddSourceView) => {
    if (nextView === 'repository') resetBrowser();
    setView(nextView);
  }, [resetBrowser]);

  return (
    <>
      <SourceChooserDialog open={open && view === 'choose'} onClose={close} onChoose={choose} />
      <SourceUploadModal
        open={open && (view === 'upload' || view === 'write')}
        mode={view === 'write' ? 'write' : 'upload'}
        owner={owner}
        repository={repository}
        blueprintId={blueprintId}
        existingNames={existingNames}
        onOpenChange={(next) => !next && close()}
        onUploaded={(source) => {
          onUploaded(source);
          close();
        }}
      />
      <RepositorySourceBrowserDialog
        open={open && view === 'repository'}
        owner={owner}
        repository={repository}
        action={repositoryAction}
        excludedPathCount={excludedRepoPaths.length}
        browser={browser}
        onClose={close}
      />
    </>
  );
}

export default AddSourceDialog;
