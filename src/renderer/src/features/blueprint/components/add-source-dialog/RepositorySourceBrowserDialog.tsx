import { useRef } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SelectionIndicator, SelectionListSearch } from '@/components/ui/selection-list';
import type { RepositoryFileEntry } from '@/lib/api';
import { cn } from '@/lib/utils';
import { emptyRepositoryMessage, type RepositoryAction } from './model';
import type { RepositorySourceBrowser } from './use-repository-source-browser';

interface RepositorySourceBrowserDialogProps {
  open: boolean;
  owner: string;
  repository: string;
  action: RepositoryAction;
  excludedPathCount: number;
  browser: RepositorySourceBrowser;
  onClose: () => void;
}

export function RepositorySourceBrowserDialog({
  open,
  owner,
  repository,
  action,
  excludedPathCount,
  browser,
  onClose,
}: RepositorySourceBrowserDialogProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !browser.submitting && onClose()}>
      <DialogContent showCloseButton={false} initialFocus={searchInputRef} className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Choose from repository</DialogTitle>
          <DialogDescription>
            {action === 'import' ? 'Select a LaTeX, Markdown, or PDF file from ' : 'Select a file from '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{owner}/{repository}</code>.
          </DialogDescription>
        </DialogHeader>
        <SelectionListSearch
          ref={searchInputRef}
          type="search"
          aria-label="Search repository files"
          placeholder="Search repository files…"
          value={browser.filter}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => browser.setFilter(event.target.value)}
        />
        {!browser.filter.trim() && <RepositoryPathNav browser={browser} />}
        <RepositoryFileList browser={browser} action={action} excludedPathCount={excludedPathCount} />
        {browser.truncated && <p className="m-0 text-xs text-muted-foreground">Only the first 5,000 repository files are shown.</p>}
        {browser.submitError && <p className="m-0 text-sm text-destructive">{browser.submitError}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" disabled={browser.submitting} onClick={onClose}>Cancel</Button>
          <Button disabled={!browser.selectedFile || browser.submitting} onClick={browser.confirm}>
            {browser.submitting ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RepositoryPathNav({ browser }: { browser: RepositorySourceBrowser }) {
  const pathSegments = browser.currentPath ? browser.currentPath.split('/') : [];
  return (
    <nav aria-label="Repository path" className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-xs">
      <button type="button" className="shrink-0 cursor-pointer rounded-md px-1.5 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-primary" onClick={() => browser.setCurrentPath('')}>
        Repository
      </button>
      {pathSegments.map((segment, index) => {
        const path = pathSegments.slice(0, index + 1).join('/');
        return (
          <span key={path} className="flex min-w-0 items-center">
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            <button type="button" className="max-w-40 cursor-pointer truncate rounded-md px-1.5 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-primary" onClick={() => browser.setCurrentPath(path)}>
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function RepositoryFileList({
  browser,
  action,
  excludedPathCount,
}: Pick<RepositorySourceBrowserDialogProps, 'browser' | 'action' | 'excludedPathCount'>) {
  let content: React.ReactNode;
  if (browser.loading) content = <ListMessage>Loading repository files…</ListMessage>;
  else if (browser.filesError) content = <ListMessage destructive>{browser.filesError}</ListMessage>;
  else if (!browser.cloneReady) content = <ListMessage>Repository files will be available once the workspace has loaded.</ListMessage>;
  else if (browser.availableFiles.length === 0) content = <ListMessage>{emptyRepositoryMessage(action, excludedPathCount)}</ListMessage>;
  else if (browser.filter.trim()) content = <SearchResults browser={browser} />;
  else if (browser.folderContents.folders.length || browser.folderContents.files.length) content = <FolderResults browser={browser} />;
  else content = <ListMessage>No files in this folder.</ListMessage>;
  return (
    <div role="group" aria-label="Repository files" className="flex h-72 flex-col overflow-y-auto rounded-lg border border-border p-1">
      {content}
    </div>
  );
}

function SearchResults({ browser }: { browser: RepositorySourceBrowser }) {
  if (!browser.searchResults.length) {
    return <ListMessage>No files match &quot;{browser.filter}&quot;.</ListMessage>;
  }
  return browser.searchResults.map((file) => (
    <RepositoryFileRow
      key={file.path}
      file={file}
      selected={browser.selectedPath === file.path}
      showFullPath
      onSelect={() => browser.setSelectedPath(file.path)}
    />
  ));
}

function FolderResults({ browser }: { browser: RepositorySourceBrowser }) {
  return (
    <>
      {browser.folderContents.folders.map((folder) => (
        <button
          key={folder}
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted hover:text-primary"
          onClick={() => browser.setCurrentPath(browser.currentPath ? `${browser.currentPath}/${folder}` : folder)}
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">{folder}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ))}
      {browser.folderContents.files.map((file) => (
        <RepositoryFileRow key={file.path} file={file} selected={browser.selectedPath === file.path} onSelect={() => browser.setSelectedPath(file.path)} />
      ))}
    </>
  );
}

function ListMessage({ children, destructive = false }: { children: React.ReactNode; destructive?: boolean }) {
  return <p className={cn('m-auto px-4 text-center text-sm text-muted-foreground', destructive && 'text-destructive')}>{children}</p>;
}

interface RepositoryFileRowProps {
  file: RepositoryFileEntry;
  selected: boolean;
  showFullPath?: boolean;
  onSelect: () => void;
}

function RepositoryFileRow({ file, selected, showFullPath = false, onSelect }: RepositoryFileRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn('group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent', selected && 'bg-accent')}
      onClick={onSelect}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-sm font-medium text-foreground group-hover:text-primary', selected && 'text-primary')}>{file.name}</span>
        {showFullPath && file.path !== file.name ? <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">{file.path}</span> : null}
      </span>
      {selected && <SelectionIndicator />}
    </button>
  );
}
