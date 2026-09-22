import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { blueprintModeUrl } from '@/features/blueprint/lib/blueprint-helpers';
import { fetchRepositorySources, type RepositorySource } from '@/lib/api';
import type { ChatContextAttachment } from '@/state/chat';

import type { BlueprintRouteIdentity } from './blueprint-page-types';

function attachmentKey(attachment: ChatContextAttachment): string {
  return JSON.stringify({
    attachment_kind: attachment.attachment_kind,
    source_id: attachment.source_id,
    repo_path: attachment.repo_path,
    artifact_kind: attachment.artifact_kind,
    selection: attachment.selection,
  });
}

export function useRepositorySources({
  route,
  baseUrl,
  repositoryFileSearch,
  referenceParam,
  sourceMounted,
  openFile,
}: {
  route: BlueprintRouteIdentity;
  baseUrl: string;
  repositoryFileSearch: string;
  referenceParam: string | null;
  sourceMounted: boolean;
  openFile: (file: string, line?: number) => void;
}) {
  const { owner, repo, blueprintId } = route;
  const navigate = useNavigate();
  const [sources, setSources] = useState<RepositorySource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const selectedSourceIdRef = useRef('');
  selectedSourceIdRef.current = selectedSourceId;
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draftAttachments, setDraftAttachments] = useState<ChatContextAttachment[]>([]);

  const visibleSources = useMemo(() => sources.filter((source) =>
    !source.metadata?.project_scoped
    || source.metadata?.scoped_blueprint_id === blueprintId), [sources, blueprintId]);

  const loadSources = useCallback(async (preferredSourceId = ''): Promise<void> => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetchRepositorySources(owner, repo, blueprintId);
      setSources(response.sources);
      setLoaded(true);
      const candidate = preferredSourceId || selectedSourceIdRef.current;
      if (candidate && response.sources.some((source) => source.id === candidate)) {
        setSelectedSourceId(candidate);
      } else {
        const blueprintSource = response.sources.find(
          (source) => source.metadata?.blueprint_id === blueprintId,
        );
        setSelectedSourceId(blueprintSource?.id || response.sources[0]?.id || '');
      }
    } catch {
      setSources([]);
      setSelectedSourceId('');
      setLoadFailed(true);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, blueprintId]);

  useEffect(() => {
    if (sourceMounted) void loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMounted]);

  useEffect(() => {
    if (referenceParam) setSelectedSourceId(referenceParam);
  }, [referenceParam]);

  const handleSourceUploaded = useCallback((source: RepositorySource) => {
    setSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
    setLoaded(true);
    setSelectedSourceId(source.id);
    void loadSources(source.id);
  }, [loadSources]);

  const addDraftAttachment = useCallback((attachment: ChatContextAttachment) => {
    const key = attachmentKey(attachment);
    setDraftAttachments((current) =>
      current.some((item) => attachmentKey(item) === key) ? current : [...current, attachment]);
  }, []);

  const openContextAttachment = useCallback((attachment: ChatContextAttachment) => {
    if (attachment.attachment_kind === 'repo_file' && attachment.repo_path) {
      openFile(attachment.repo_path, attachment.selection?.start_line);
      return;
    }
    if (!attachment.source_id) return;
    const query = new URLSearchParams(repositoryFileSearch);
    query.set('reference', attachment.source_id);
    navigate(blueprintModeUrl(baseUrl, 'view', query.toString()));
    setSelectedSourceId(attachment.source_id);
    if (!sources.some((source) => source.id === attachment.source_id)) {
      void loadSources(attachment.source_id);
    }
  }, [navigate, baseUrl, repositoryFileSearch, loadSources, sources, openFile]);

  return {
    sources,
    visibleSources,
    selectedSourceId,
    selectedSourceIdRef,
    loading,
    loadFailed,
    loaded,
    loadSources,
    draftAttachments,
    setDraftAttachments,
    handleSourceUploaded,
    addDraftAttachment,
    openContextAttachment,
  };
}
