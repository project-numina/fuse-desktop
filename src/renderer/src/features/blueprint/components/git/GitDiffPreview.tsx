import type { BlueprintDiffFile } from '@/lib/api';
import type { StructuredLine } from '@/features/blueprint/lib/structured-diff';
import DiffRows from '@/features/blueprint/components/git/DiffRows';
import GitPaneState from '@/features/blueprint/components/git/GitPaneState';

interface GitDiffPreviewProps {
  file: BlueprintDiffFile | null;
  lines: StructuredLine[];
  visibleFileCount: number;
  hiddenMetadataCount: number;
}

function EmptyDiffPreview({
  visibleFileCount,
  hiddenMetadataCount,
}: Pick<GitDiffPreviewProps, 'visibleFileCount' | 'hiddenMetadataCount'>) {
  if (visibleFileCount > 0) {
    return <GitPaneState spacious>Select a file to see its diff.</GitPaneState>;
  }
  return (
    <GitPaneState spacious>
      <h2 className="mb-[var(--space-2)] text-lg font-semibold text-[var(--text-primary)]">
        {hiddenMetadataCount > 0 ? 'No visible changes' : 'No local changes'}
      </h2>
      <p className="mx-auto max-w-[28rem] text-sm text-[var(--text-muted)]">
        {hiddenMetadataCount > 0
          ? 'Only generated metadata changed.'
          : 'Edit the blueprint or run an agent. Pending changes in this folder will show up here for review.'}
      </p>
    </GitPaneState>
  );
}

function FileName({ path }: { path: string }) {
  return (
    <code className="[font-family:var(--numina-font-mono)] text-[0.85em] text-[var(--text-body)]">
      {path}
    </code>
  );
}

function UnavailableDiff({ file }: { file: BlueprintDiffFile }) {
  if (file.binary) {
    return (
      <GitPaneState spacious>
        <FileName path={file.path} />{' '}is a binary file; no diff preview is available.
      </GitPaneState>
    );
  }
  if (file.truncated) {
    return (
      <GitPaneState spacious>
        Diff for <FileName path={file.path} /> is too large to preview here.
      </GitPaneState>
    );
  }
  return (
    <GitPaneState spacious>
      No textual changes to preview for <FileName path={file.path} />.
    </GitPaneState>
  );
}

function DiffHeader({ file }: { file: BlueprintDiffFile }) {
  return (
    <header className="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--numina-border-light)] bg-[var(--numina-surface-sunken)] px-[var(--space-4)] py-[var(--space-2)]">
      <span className="flex-1 [font-family:var(--numina-font-mono)] text-xs text-[var(--text-body)] [overflow-wrap:anywhere]">
        {file.path}
      </span>
      <span className="inline-flex gap-[var(--space-1)] [font-family:var(--numina-font-mono)] text-[0.7rem]">
        {file.additions > 0 && (
          <span className="font-semibold text-[var(--status-verified-text)]">
            +{file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="font-semibold text-[var(--status-unformalized-text)]">
            -{file.deletions}
          </span>
        )}
      </span>
    </header>
  );
}

function GitDiffPreview({
  file,
  lines,
  visibleFileCount,
  hiddenMetadataCount,
}: GitDiffPreviewProps) {
  if (!file) {
    return (
      <EmptyDiffPreview
        visibleFileCount={visibleFileCount}
        hiddenMetadataCount={hiddenMetadataCount}
      />
    );
  }
  if (file.binary || file.truncated || !file.diff) {
    return <UnavailableDiff file={file} />;
  }
  return (
    <div className="flex h-full flex-col">
      <DiffHeader file={file} />
      <DiffRows lines={lines} />
    </div>
  );
}

export default GitDiffPreview;
