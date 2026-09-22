import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  fetchRepositoryFiles,
  type RepositoryFileEntry,
} from '@/lib/api';
import {
  availableRepositoryFiles,
  errorMessage,
  repositoryFolderContents,
  searchRepositoryFiles,
  type RepositoryAction,
} from './model';

interface BrowserOptions {
  active: boolean;
  open: boolean;
  owner: string;
  repository: string;
  blueprintId: string;
  excludedPaths: readonly string[];
  action: RepositoryAction;
  onSelect: (file: RepositoryFileEntry) => void | Promise<void>;
  onComplete: () => void;
}

interface LoadedFiles {
  files: RepositoryFileEntry[];
  loading: boolean;
  filesError: string | null;
  cloneReady: boolean;
  truncated: boolean;
}

const EMPTY_LOADED_FILES: LoadedFiles = {
  files: [],
  loading: false,
  filesError: null,
  cloneReady: true,
  truncated: false,
};

function useRepositoryFiles(options: BrowserOptions): LoadedFiles {
  const [state, setState] = useState(EMPTY_LOADED_FILES);
  useEffect(() => {
    if (options.open) setState(EMPTY_LOADED_FILES);
  }, [options.open]);
  useEffect(() => {
    if (!options.active) return;
    let active = true;
    setState((current) => ({ ...current, loading: true, filesError: null }));
    void fetchRepositoryFiles(options.owner, options.repository, options.blueprintId)
      .then((response) => {
        if (!active) return;
        setState({ files: response.files, loading: false, filesError: null, cloneReady: response.clone_ready, truncated: response.truncated });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState((current) => ({ ...current, loading: false, filesError: errorMessage(error, 'Could not load repository files.') }));
      });
    return () => {
      active = false;
    };
  }, [options.active, options.owner, options.repository, options.blueprintId]);
  return state;
}

function useBrowserNavigation(options: BrowserOptions, files: readonly RepositoryFileEntry[]) {
  const [currentPath, setCurrentPath] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const reset = useCallback(() => {
    setCurrentPath('');
    setFilter('');
    setSelectedPath(null);
  }, []);
  useEffect(() => {
    if (options.open) reset();
  }, [options.open, reset]);
  const availableFiles = useMemo(
    () => availableRepositoryFiles(files, options.excludedPaths, options.action),
    [files, options.excludedPaths, options.action],
  );
  return {
    availableFiles,
    currentPath,
    filter,
    folderContents: useMemo(() => repositoryFolderContents(availableFiles, currentPath), [availableFiles, currentPath]),
    reset,
    searchResults: useMemo(() => searchRepositoryFiles(availableFiles, filter), [availableFiles, filter]),
    selectedFile: selectedPath ? availableFiles.find((file) => file.path === selectedPath) : undefined,
    selectedPath,
    setCurrentPath,
    setFilter,
    setSelectedPath,
  };
}

function useRepositorySubmission(options: BrowserOptions, selectedFile: RepositoryFileEntry | undefined) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useCallback(() => {
    setSubmitting(false);
    setError(null);
  }, []);
  useEffect(() => {
    if (options.open) reset();
  }, [options.open, reset]);
  const confirm = useCallback(async () => {
    if (!selectedFile || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await options.onSelect(selectedFile);
      options.onComplete();
    } catch (submitError) {
      setError(errorMessage(submitError, 'Could not add this repository file.'));
    } finally {
      setSubmitting(false);
    }
  }, [options, selectedFile, submitting]);
  return { confirm, reset, submitError: error, submitting };
}

export function useRepositorySourceBrowser(options: BrowserOptions) {
  const loaded = useRepositoryFiles(options);
  const navigation = useBrowserNavigation(options, loaded.files);
  const submission = useRepositorySubmission(options, navigation.selectedFile);
  const resetNavigation = navigation.reset;
  const resetSubmission = submission.reset;
  const reset = useCallback(() => {
    resetNavigation();
    resetSubmission();
  }, [resetNavigation, resetSubmission]);
  return { ...loaded, ...navigation, ...submission, reset };
}

export type RepositorySourceBrowser = ReturnType<typeof useRepositorySourceBrowser>;
