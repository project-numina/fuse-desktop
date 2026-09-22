import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { fileKind } from '@/features/blueprint/components/FileViewer';
import { useInfoview } from '@/features/blueprint/hooks/infoview';
import { useRepositoryDirectory } from '@/features/blueprint/hooks/use-repository-directory';
import { blueprintModeUrl, isProjectLeanFile } from '@/features/blueprint/lib/blueprint-helpers';
import { request } from '@/lib/api';
import { LEAN_SETUP_READY_EVENT, type LeanSetupTarget } from '@/lib/lean-setup-events';
import { useFileParam } from '@/lib/route-params';

import type { BlueprintData, BlueprintRouteIdentity } from './blueprint-page-types';

type JumpTarget = { file: string; line: number; column: number };

interface BlueprintFilesOptions {
  route: BlueprintRouteIdentity;
  baseUrl: string;
  mode: string;
  modeParam: string;
  blueprint: BlueprintData | null;
  isReadonly: boolean;
  onDirty: () => void;
}

function fileRequestPath(route: BlueprintRouteIdentity, filePath: string): string {
  const { owner, repo, blueprintId } = route;
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  return `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/files/${path}?ref=${encodeURIComponent(`numina/${blueprintId}`)}`;
}

function repositoryFileSearch(search: string): string {
  const fileSearch = new URLSearchParams(search);
  fileSearch.delete('reference');
  return fileSearch.toString();
}

function useSelectedFileState(mode: string, fileParam: string | null, showingReference: boolean) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const selectedFileRef = useRef<string | null>(null);
  selectedFileRef.current = selectedFile;
  const [pendingJumpTarget, setPendingJumpTarget] = useState<JumpTarget | null>(null);

  useEffect(() => {
    if (mode !== 'view') return;
    const requested = showingReference ? null : fileParam || null;
    setSelectedFile((previous) => previous === requested ? previous : requested);
  }, [mode, fileParam, showingReference]);

  return {
    selectedFile,
    setSelectedFile,
    selectedFileRef,
    pendingJumpTarget,
    setPendingJumpTarget,
  };
}

function useLeanSetupReload(
  route: BlueprintRouteIdentity,
  setupRequired: boolean | undefined,
  reloadFile: () => Promise<unknown>,
): void {
  const { owner, repo, blueprintId } = route;
  useEffect(() => {
    const handleReady = (event: Event) => {
      const target = (event as CustomEvent<LeanSetupTarget>).detail;
      if (setupRequired && target?.owner === owner && target.repo === repo
        && target.blueprintId === blueprintId) void reloadFile();
    };
    window.addEventListener(LEAN_SETUP_READY_EVENT, handleReady);
    return () => window.removeEventListener(LEAN_SETUP_READY_EVENT, handleReady);
  }, [owner, repo, blueprintId, setupRequired, reloadFile]);
}

function useFileContentState() {
  const [fileContent, setFileContent] = useState('');
  const fileContentRef = useRef('');
  fileContentRef.current = fileContent;
  const [fileLoading, setFileLoading] = useState(false);
  const fileLoadingRef = useRef(false);
  fileLoadingRef.current = fileLoading;
  const [fileError, setFileError] = useState(false);
  const fileLoadControllerRef = useRef<AbortController | null>(null);
  return {
    fileContent,
    setFileContent,
    fileContentRef,
    fileLoading,
    setFileLoading,
    fileLoadingRef,
    fileError,
    setFileError,
    fileLoadControllerRef,
  };
}

type FileContentState = ReturnType<typeof useFileContentState>;

function clearFileContent(state: FileContentState): void {
  state.fileLoadControllerRef.current?.abort();
  state.fileLoadingRef.current = false;
  state.setFileLoading(false);
  state.setFileError(false);
  state.setFileContent('');
}

function restorePendingContent(state: FileContentState, content: string): boolean {
  state.fileLoadControllerRef.current?.abort();
  state.fileLoadingRef.current = false;
  state.setFileLoading(false);
  state.setFileError(false);
  const changed = content !== state.fileContentRef.current;
  state.setFileContent(content);
  return changed;
}

function beginFileRequest(state: FileContentState, silent: boolean): AbortController {
  state.fileLoadControllerRef.current?.abort();
  const controller = new AbortController();
  state.fileLoadControllerRef.current = controller;
  if (!silent) {
    state.fileLoadingRef.current = true;
    state.setFileLoading(true);
    state.setFileError(false);
  }
  return controller;
}

function acceptFileResponse(
  state: FileContentState,
  selectedFileRef: MutableRefObject<string | null>,
  getPendingSaveContent: (filePath: string) => string | undefined,
  controller: AbortController,
  filePath: string,
  content: string,
): boolean {
  if (controller.signal.aborted || selectedFileRef.current !== filePath) return false;
  const nextContent = getPendingSaveContent(filePath) ?? content;
  const changed = nextContent !== state.fileContentRef.current;
  state.setFileContent(nextContent);
  state.setFileError(false);
  return changed;
}

function rejectFileResponse(
  state: FileContentState,
  setPendingJumpTarget: Dispatch<SetStateAction<JumpTarget | null>>,
  controller: AbortController,
  filePath: string,
  silent: boolean,
): false {
  if (controller.signal.aborted || silent) return false;
  state.setFileContent('');
  state.setFileError(true);
  setPendingJumpTarget((pending) => pending?.file === filePath ? null : pending);
  return false;
}

function finishFileRequest(
  state: FileContentState,
  controller: AbortController,
  silent: boolean,
): void {
  if (!silent && !controller.signal.aborted) {
    state.fileLoadingRef.current = false;
    state.setFileLoading(false);
  }
}

function useLoadOpenFile(
  route: BlueprintRouteIdentity,
  selection: ReturnType<typeof useSelectedFileState>,
  state: FileContentState,
  getPendingSaveContent: (filePath: string) => string | undefined,
) {
  return useCallback(async (options: { silent?: boolean } = {}): Promise<boolean> => {
    const filePath = selection.selectedFileRef.current;
    const silent = options.silent ?? false;
    if (!filePath || ['pdf', 'binary'].includes(fileKind(filePath))) {
      clearFileContent(state);
      return false;
    }
    // Check the draft before the silent-load guard so a pending edit is never hidden.
    const pendingContent = getPendingSaveContent(filePath);
    if (pendingContent !== undefined) return restorePendingContent(state, pendingContent);
    if (silent && state.fileLoadingRef.current) return false;
    const controller = beginFileRequest(state, silent);
    try {
      const data = await request<{ content: string }>(fileRequestPath(route, filePath), {
        signal: controller.signal,
      });
      return acceptFileResponse(
        state, selection.selectedFileRef, getPendingSaveContent,
        controller, filePath, data.content,
      );
    } catch {
      return rejectFileResponse(state, selection.setPendingJumpTarget, controller, filePath, silent);
    } finally {
      finishFileRequest(state, controller, silent);
    }
  }, [route, selection, state, getPendingSaveContent]);
}

function useOpenFileReload(
  mode: string,
  selectedFile: string | null,
  loadOpenFile: (options?: { silent?: boolean }) => Promise<boolean>,
): void {
  useEffect(() => {
    if (mode === 'view') void loadOpenFile();
    // Reload only for file or mode changes, not callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, mode]);
}

function useFileActions(
  isReadonly: boolean,
  onDirty: () => void,
  saveAndRefresh: (value: string) => void,
  selection: ReturnType<typeof useSelectedFileState>,
  state: FileContentState,
) {
  const handleContentChange = useCallback((value: string) => {
    if (isReadonly) return;
    state.setFileContent(value);
    onDirty();
    saveAndRefresh(value);
  }, [isReadonly, state, saveAndRefresh, onDirty]);
  const handleDiagnosticJump = useCallback(({ line, column }: { line: number; column: number }) => {
    const file = selection.selectedFileRef.current;
    if (file && line > 0) selection.setPendingJumpTarget({ file, line, column });
  }, [selection]);
  return { handleContentChange, handleDiagnosticJump };
}

function useFileBrowser(
  route: BlueprintRouteIdentity,
  projectDirectory: string,
  mode: string,
  blueprint: BlueprintData | null,
) {
  const [browserPath, setBrowserPath] = useState<{ project: string; directory: string } | null>(null);
  const browserDirectory = browserPath?.project === projectDirectory
    ? browserPath.directory
    : projectDirectory;
  const setBrowserDirectory = useCallback((directory: string) => {
    setBrowserPath({ project: projectDirectory, directory });
  }, [projectDirectory]);
  const directory = useRepositoryDirectory(
    route.owner,
    route.repo,
    route.blueprintId,
    browserDirectory,
    mode === 'view' && Boolean(blueprint),
  );
  const availableFiles = useMemo(() => directory.files.map((file) => file.path), [directory.files]);
  return { setBrowserPath, setBrowserDirectory, directory, availableFiles };
}

function useFileNavigation(
  baseUrl: string,
  search: string,
  selection: ReturnType<typeof useSelectedFileState>,
) {
  const navigate = useNavigate();
  const selectFile = useCallback((next: string | null) => {
    selection.setPendingJumpTarget(null);
    navigate(blueprintModeUrl(baseUrl, 'view', search, next));
  }, [navigate, baseUrl, search, selection]);
  const openFile = useCallback((file: string, line = 0) => {
    selection.setSelectedFile(file);
    selection.setPendingJumpTarget(line > 0 ? { file, line, column: 1 } : null);
    navigate(blueprintModeUrl(baseUrl, 'view', search, file));
  }, [navigate, baseUrl, search, selection]);
  return { selectFile, openFile };
}

function blueprintFilesResult(
  selection: ReturnType<typeof useSelectedFileState>,
  selectedFileIsLean: boolean,
  projectDirectory: string,
  browser: ReturnType<typeof useFileBrowser>,
  routeState: { referenceParam: string | null; showingReference: boolean; search: string },
  infoview: ReturnType<typeof useInfoview>,
  content: FileContentState,
  loadOpenFile: (options?: { silent?: boolean }) => Promise<boolean>,
  actions: ReturnType<typeof useFileActions>,
  navigation: ReturnType<typeof useFileNavigation>,
) {
  return {
    selectedFile: selection.selectedFile,
    setSelectedFile: selection.setSelectedFile,
    selectedFileIsLean,
    pendingJumpTarget: selection.pendingJumpTarget,
    setPendingJumpTarget: selection.setPendingJumpTarget,
    projectDirectory,
    setBrowserPath: browser.setBrowserPath,
    setBrowserDirectory: browser.setBrowserDirectory,
    directory: browser.directory,
    availableFiles: browser.availableFiles,
    referenceParam: routeState.referenceParam,
    showingReference: routeState.showingReference,
    repositoryFileSearch: routeState.search,
    infoview,
    fileContent: content.fileContent,
    fileLoading: content.fileLoading,
    fileError: content.fileError,
    loadOpenFile,
    handleContentChange: actions.handleContentChange,
    handleDiagnosticJump: actions.handleDiagnosticJump,
    selectFile: navigation.selectFile,
    openFile: navigation.openFile,
  };
}

export function useBlueprintFiles(options: BlueprintFilesOptions) {
  const { route, baseUrl, mode, modeParam, blueprint, isReadonly, onDirty } = options;
  const { owner, repo, blueprintId } = route;
  const location = useLocation();
  const fileParam = useFileParam();
  const referenceParam = new URLSearchParams(location.search).get('reference');
  const showingReference = modeParam === 'source' || Boolean(referenceParam);
  const search = repositoryFileSearch(location.search);
  const selection = useSelectedFileState(mode, fileParam, showingReference);
  const projectDirectory = blueprint?.project_subdir || '';
  const selectedFileIsLean = isProjectLeanFile(selection.selectedFile, projectDirectory);
  const infoview = useInfoview({
    owner, repo, blueprintId,
    filePath: selectedFileIsLean ? selection.selectedFile : null,
  });
  useLeanSetupReload(route, infoview.state.setupRequired, infoview.reloadFile);
  const content = useFileContentState();
  const loadOpenFile = useLoadOpenFile(route, selection, content, infoview.getPendingSaveContent);
  useOpenFileReload(mode, selection.selectedFile, loadOpenFile);
  const actions = useFileActions(
    isReadonly, onDirty, infoview.saveAndRefresh, selection, content,
  );
  const browser = useFileBrowser(route, projectDirectory, mode, blueprint);
  const navigation = useFileNavigation(baseUrl, search, selection);
  return blueprintFilesResult(
    selection, selectedFileIsLean, projectDirectory, browser,
    { referenceParam, showingReference, search }, infoview, content,
    loadOpenFile, actions, navigation,
  );
}
