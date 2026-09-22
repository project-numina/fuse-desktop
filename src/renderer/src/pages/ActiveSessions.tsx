import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { ActiveSessionSummary } from '@/lib/api';
import { useActiveSessions } from '@/state/active-sessions';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 5000;

/**
 * Active sessions page — lists the current user's live agent sessions and lets
 * them cancel ones from other tabs or blueprints. Reached from the header clock
 * affordance, or automatically (with `reason=cap_hit`) when starting a chat
 * fails because the per-user concurrent-session cap is hit.
 *
 */
export default function ActiveSessions() {
  const [searchParams] = useSearchParams();
  const { state, setReason, refresh, cancelOne } = useActiveSessions();

  const isCapHit = state.reason === 'cap_hit';

  const subheading = isCapHit
    ? "You've reached the limit on concurrent sessions. Cancel one to start a new chat."
    : 'These chats are currently using a session slot.';

  const countLabel = state.maxActive
    ? `${state.activeCount}/${state.maxActive}`
    : '';

  const reasonParam = searchParams.get('reason');

  // Mirror `loading` into a ref so the polling closure (set up once) reads the
  // latest value rather than the snapshot captured when the effect ran.
  const loadingRef = useRef(state.loading);
  loadingRef.current = state.loading;

  // On mount: record why the page is shown, refresh, then poll on a short
  // interval (the active-session list changes whenever a chat starts or
  // finishes anywhere across the user's repos, and there is no user-scoped
  // event stream). Pause polling while the tab is hidden.
  useEffect(() => {
    setReason(reasonParam === 'cap_hit' ? 'cap_hit' : 'manual');
    void refresh();

    const pollTimer = setInterval(() => {
      if (loadingRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    }, POLL_INTERVAL_MS);

    function handleVisibilityChange() {
      if (typeof document !== 'undefined' && !document.hidden) void refresh();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // `refresh`/`setReason` are stable module functions; `loading` is read
    // fresh inside the interval via `loadingRef`, so this runs once per reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasonParam]);

  return (
    <div className="page-bg flex h-screen flex-col overflow-y-auto">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col px-6 pb-16 pt-12">
        <h2 className="flex items-baseline gap-3 text-2xl font-bold text-foreground">
          Active sessions
          {countLabel && (
            <span className="font-mono text-sm font-medium text-muted-foreground">
              {countLabel}
            </span>
          )}
        </h2>

        {isCapHit ? (
          <p
            className="my-4 mb-8 rounded-lg border border-border bg-accent px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {subheading}
          </p>
        ) : (
          <p className="mb-8 mt-2 text-sm text-muted-foreground">{subheading}</p>
        )}

        {state.error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        {state.loading && state.sessions.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Loading…</p>
        ) : state.sessions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 pb-[12vh] pt-4 text-center text-muted-foreground">
            <p className="text-base font-semibold text-foreground/80">
              No active sessions
            </p>
            <p className="text-sm text-muted-foreground">
              Chats you start will appear here while they run.
            </p>
          </div>
        ) : (
          <div className="flex flex-col border-t border-border">
            {state.sessions.map((entry) => (
              <SessionRow
                key={entry.session_id}
                entry={entry}
                cancelRequested={state.cancelRequestedIds.has(entry.session_id)}
                onCancel={() => cancelOne(entry.session_id)}
              />
            ))}
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  );
}

export function activeSessionStatusTone(
  entry: ActiveSessionSummary,
  cancelRequested: boolean,
): string {
  if (cancelRequested) return 'stopping';
  if (
    entry.turn_active
    || Boolean(entry.active_prover_batch_id)
    || (entry.active_work_group_count ?? 0) > 0
  ) return 'working';
  if (entry.status === 'starting') return 'starting';
  if (entry.status === 'running') return 'idle';
  return 'stopped';
}

const toneDotClass: Record<string, string> = {
  working: 'bg-emerald-500 animate-pulse',
  starting: 'bg-blue-500 animate-pulse',
  idle: 'bg-emerald-500',
  stopping: 'bg-amber-500 animate-pulse',
  stopped: 'bg-muted-foreground/50',
};

function SessionRow({
  entry,
  cancelRequested,
  onCancel,
}: {
  entry: ActiveSessionSummary;
  cancelRequested: boolean;
  onCancel: () => void;
}) {
  const tone = useMemo(
    () => activeSessionStatusTone(entry, cancelRequested),
    [entry, cancelRequested],
  );
  const statusText = cancelRequested ? 'Cancel requested…' : entry.display_status;

  return (
    <div className="relative flex items-center gap-4 border-b border-border px-3 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">
            {entry.repository_owner}/{entry.repository_name}
          </span>
        </div>
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground/80"
          title={entry.workspace_label}
        >
          {entry.workspace_label}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn('h-[7px] w-[7px] flex-shrink-0 rounded-full', toneDotClass[tone])}
          />
          {statusText}
        </span>
      </div>
      <button
        type="button"
        className="flex-shrink-0 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground/80 transition-colors hover:border-destructive hover:bg-destructive hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-foreground/80"
        disabled={!entry.can_cancel || cancelRequested}
        onClick={onCancel}
      >
        {cancelRequested ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}
