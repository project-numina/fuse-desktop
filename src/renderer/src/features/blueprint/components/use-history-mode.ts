import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { deleteSessionHistory, fetchNativeHistoryStatus, fetchSessionHistory } from '@/lib/api';
import { refreshSessionAttention } from '@/hooks/use-session-attention';
import { SESSION_HISTORY_CHANGED_EVENT } from '@/lib/session-events';
import { HISTORY_PAGE_SIZE, isTerminalSessionStatus, type HistoryModeProps, type SessionHistorySummary } from './history-mode-model';

interface HistoryState {
  sessions: SessionHistorySummary[];
  historyLoading: boolean;
  historyError: string | null;
  nativeWarnings: string[];
  nativeRefreshing: boolean;
  actionError: string | null;
  deleting: boolean;
  loadingMore: boolean;
  hasMore: boolean;
}

export interface HistoryModeController extends Omit<HistoryState, 'deleting'> {
  selectSession(session: SessionHistorySummary): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  loadMore(): Promise<void>;
}

type SetHistoryState = Dispatch<SetStateAction<HistoryState>>;
type ControllerInput = Pick<HistoryModeProps,
  'owner' | 'repo' | 'blueprintId' | 'onSelectSession' | 'onNewChat'
  | 'activeSessionId' | 'currentJobId' | 'sessionStatus'>;
type Identity = Pick<HistoryModeProps, 'owner' | 'repo' | 'blueprintId'>;

const INITIAL_STATE: HistoryState = {
  sessions: [], historyLoading: false, historyError: null, nativeWarnings: [],
  nativeRefreshing: false, actionError: null, deleting: false, loadingMore: false, hasMore: false,
};

function patchState(setState: SetHistoryState, patch: Partial<HistoryState>): void {
  setState((previous) => ({ ...previous, ...patch }));
}

function applyResults(setState: SetHistoryState, results: SessionHistorySummary[], notify = true): void {
  patchState(setState, { sessions: results, hasMore: results.length >= HISTORY_PAGE_SIZE });
  if (notify) void refreshSessionAttention();
}

function useHistoryLoader(identity: Identity, setState: SetHistoryState, requestId: MutableRefObject<number>) {
  const { owner, repo, blueprintId } = identity;
  return useCallback(async (options: { silent?: boolean; refreshNative?: boolean } = {}): Promise<void> => {
    const id = ++requestId.current;
    if (!options.silent) patchState(setState, { historyLoading: true });
    patchState(setState, { historyError: null, nativeWarnings: [] });
    try {
      const results = await fetchSessionHistory(owner, repo, blueprintId, HISTORY_PAGE_SIZE, 0, options.refreshNative ?? true) as SessionHistorySummary[];
      if (requestId.current !== id) return;
      applyResults(setState, results);
      patchState(setState, { historyLoading: false });
      const status = await fetchNativeHistoryStatus(owner, repo, blueprintId).catch(() => ({ warnings: ['Native history status is unavailable.'] }));
      if (requestId.current !== id) return;
      patchState(setState, { nativeWarnings: status.warnings, nativeRefreshing: 'refreshing' in status && status.refreshing === true });
      if (options.refreshNative !== false && 'refreshing' in status && status.refreshing === false) {
        const fresh = await fetchSessionHistory(owner, repo, blueprintId, HISTORY_PAGE_SIZE, 0, false).catch(() => results) as SessionHistorySummary[];
        if (requestId.current === id) applyResults(setState, fresh, false);
      }
    } catch {
      if (requestId.current === id) patchState(setState, { historyError: 'Could not load session history. Please try again.' });
    } finally {
      if (requestId.current === id) patchState(setState, { historyLoading: false });
    }
  }, [owner, repo, blueprintId, requestId, setState]);
}

function useNativeHistoryPolling(identity: Identity, refreshing: boolean, loadHistory: ReturnType<typeof useHistoryLoader>, setState: SetHistoryState): void {
  const { owner, repo, blueprintId } = identity;
  useEffect(() => {
    if (!refreshing) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      try {
        const status = await fetchNativeHistoryStatus(owner, repo, blueprintId);
        if (disposed) return;
        patchState(setState, { nativeWarnings: status.warnings });
        if (!status.refreshing) {
          patchState(setState, { nativeRefreshing: false });
          void loadHistory({ silent: true, refreshNative: false });
          return;
        }
      } catch {
        if (disposed) return;
        patchState(setState, { nativeRefreshing: false, nativeWarnings: ['Could not refresh native history. Existing chats are still available.'] });
        return;
      }
      timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [refreshing, owner, repo, blueprintId, loadHistory, setState]);
}

function useHistoryReloadTriggers(
  loadHistory: ReturnType<typeof useHistoryLoader>,
  requestId: MutableRefObject<number>,
  currentJobId: string | null | undefined,
  sessionStatus: string | null | undefined,
): void {
  useEffect(() => {
    void loadHistory();
    const handler = (): void => void loadHistory({ silent: true });
    window.addEventListener(SESSION_HISTORY_CHANGED_EVENT, handler);
    return () => {
      requestId.current += 1;
      window.removeEventListener(SESSION_HISTORY_CHANGED_EVENT, handler);
    };
  }, [loadHistory, requestId]);
  useEffect(() => {
    if (!currentJobId) return;
    const timeout = setTimeout(() => void loadHistory({ silent: true }), 3000);
    return () => clearTimeout(timeout);
  }, [currentJobId, loadHistory]);
  useEffect(() => {
    if (isTerminalSessionStatus(sessionStatus)) void loadHistory({ silent: true });
  }, [sessionStatus, loadHistory]);
}

function useLoadMore(identity: Identity, state: HistoryState, setState: SetHistoryState) {
  const { owner, repo, blueprintId } = identity;
  return useCallback(async (): Promise<void> => {
    if (state.loadingMore) return;
    patchState(setState, { loadingMore: true, actionError: null });
    try {
      const results = await fetchSessionHistory(owner, repo, blueprintId, HISTORY_PAGE_SIZE, state.sessions.length) as SessionHistorySummary[];
      setState((previous) => ({ ...previous, sessions: [...previous.sessions, ...results], hasMore: results.length >= HISTORY_PAGE_SIZE }));
    } catch {
      patchState(setState, { actionError: 'Could not load more sessions. Please try again.' });
    } finally {
      patchState(setState, { loadingMore: false });
    }
  }, [state.loadingMore, state.sessions.length, owner, repo, blueprintId, setState]);
}

function useSelectSession(onSelectSession: HistoryModeProps['onSelectSession'], setState: SetHistoryState) {
  return useCallback(async (session: SessionHistorySummary): Promise<void> => {
    patchState(setState, { actionError: null });
    try {
      await onSelectSession?.(session.id);
    } catch {
      patchState(setState, { actionError: 'Could not open that session. Please try again.' });
    }
  }, [onSelectSession, setState]);
}

function useDeleteSession(
  activeSessionId: string | null | undefined,
  onNewChat: HistoryModeProps['onNewChat'],
  deleting: boolean,
  setState: SetHistoryState,
) {
  return useCallback(async (sessionId: string): Promise<void> => {
    if (deleting) return;
    patchState(setState, { deleting: true, actionError: null });
    try {
      await deleteSessionHistory(sessionId);
      setState((previous) => ({ ...previous, sessions: previous.sessions.filter((session) => session.id !== sessionId) }));
      if (activeSessionId === sessionId) onNewChat?.();
    } catch {
      patchState(setState, { actionError: 'Could not delete session. Please try again.' });
    } finally {
      patchState(setState, { deleting: false });
    }
  }, [activeSessionId, onNewChat, deleting, setState]);
}

/** Owns history requests and mutations; rendering stays in `HistoryModeView`. */
export function useHistoryMode(input: ControllerInput): HistoryModeController {
  const [state, setState] = useState(INITIAL_STATE);
  const requestId = useRef(0);
  const identity = { owner: input.owner, repo: input.repo, blueprintId: input.blueprintId };
  const loadHistory = useHistoryLoader(identity, setState, requestId);
  useNativeHistoryPolling(identity, state.nativeRefreshing, loadHistory, setState);
  useHistoryReloadTriggers(loadHistory, requestId, input.currentJobId, input.sessionStatus);
  const loadMore = useLoadMore(identity, state, setState);
  const selectSession = useSelectSession(input.onSelectSession, setState);
  const deleteSession = useDeleteSession(input.activeSessionId, input.onNewChat, state.deleting, setState);
  return { ...state, loadMore, selectSession, deleteSession };
}
