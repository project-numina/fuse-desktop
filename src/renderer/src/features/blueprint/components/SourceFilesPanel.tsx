/**
 * Collapsible side panel listing a blueprint's repository sources, with an
 * "Add" source flow and per-row delete.
 */

import SourceFilesPanelView from '@/features/blueprint/components/SourceFilesPanelView';
import { useSourceFilesPanel } from '@/features/blueprint/components/use-source-files-panel';
import type { RepositorySource } from '@/lib/api';

export interface SourceFilesPanelProps {
  /** Sources visible in the current blueprint context. */
  sources?: RepositorySource[];
  /** Currently selected source id. */
  selectedSourceId?: string;
  /** Whether the source list is loading. */
  loading?: boolean;
  /** Whether the source list failed to load. */
  error?: boolean;
  /** Whether the panel is collapsed to its edge handle. */
  collapsed?: boolean;
  /** Whether the panel offers collapse/expand handles. */
  hideable?: boolean;
  /** Render edge-to-edge inside the workspace's resizable right rail. */
  rail?: boolean;
  /** Repository owner. */
  owner?: string;
  /** Repository name. */
  repository?: string;
  /** Current blueprint id; scopes workspace uploads and deletes. */
  blueprintId?: string;
  /** Hide source-management actions in a read-only workspace. */
  readonly?: boolean;
  /** Invoked with a source id when the user picks one. */
  onSelectSource?: (sourceId: string) => void;
  /** Invoked when the collapse/expand handle is clicked. */
  onToggleCollapsed?: () => void;
  /** Invoked with the created source after an upload. */
  onUploaded?: (source: RepositorySource) => void;
  /** Invoked with the deleted source id after a delete. */
  onDeleted?: (sourceId: string) => void;
}

const EMPTY_SOURCES: RepositorySource[] = [];

function SourceFilesPanel({
  sources = EMPTY_SOURCES,
  selectedSourceId = '',
  loading = false,
  error = false,
  collapsed = false,
  hideable = true,
  rail = false,
  owner = '',
  repository = '',
  blueprintId = '',
  readonly = false,
  onSelectSource,
  onToggleCollapsed,
  onUploaded,
  onDeleted,
}: SourceFilesPanelProps) {
  const controller = useSourceFilesPanel({
    sources,
    owner,
    repository,
    blueprintId,
    readonly,
    onUploaded,
    onDeleted,
  });
  return (
    <SourceFilesPanelView
      sources={sources}
      selectedSourceId={selectedSourceId}
      loading={loading}
      error={error}
      collapsed={collapsed}
      hideable={hideable}
      rail={rail}
      owner={owner}
      repository={repository}
      blueprintId={blueprintId}
      readonly={readonly}
      onSelectSource={onSelectSource}
      onToggleCollapsed={onToggleCollapsed}
      controller={controller}
    />
  );
}

export default SourceFilesPanel;
