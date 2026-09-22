import type { KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type { SessionAttention } from '@shared/session-attention';
import { useSessionAttention } from '@/hooks/use-session-attention';
import { formatShortDateTime } from '@/lib/display';
import { cn } from '@/lib/utils';
import {
  historyRowPresentation,
  historySnippet,
  type SessionHistorySummary,
} from './history-mode-model';
import type { HistoryModeController } from './use-history-mode';

interface HistoryModeViewProps extends HistoryModeController {
  readOnly: boolean;
  onNewChat?: () => void;
  className?: string;
}

function HistoryHeader({ readOnly, onNewChat }: Pick<HistoryModeViewProps, 'readOnly' | 'onNewChat'>) {
  return (
    <div className="mx-auto flex w-full max-w-[768px] shrink-0 items-center justify-between pt-10 pb-5 pr-6 pl-3">
      <h2 className="m-0 text-2xl font-bold text-[var(--text-primary)]">History</h2>
      {!readOnly && (
        <button
          type="button"
          onClick={() => onNewChat?.()}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-[var(--numina-accent)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--numina-accent)] transition-colors hover:bg-[var(--numina-accent)] hover:text-[var(--text-on-accent)]"
        >
          <Plus className="size-4" aria-hidden />
          New chat
        </button>
      )}
    </div>
  );
}

interface HistorySessionRowProps {
  session: SessionHistorySummary;
  signal?: SessionAttention;
  onSelect(session: SessionHistorySummary): Promise<void>;
  onDelete(sessionId: string): Promise<void>;
}

function HistorySessionRow({ session, signal, onSelect, onDelete }: HistorySessionRowProps) {
  const { status, unread } = historyRowPresentation(session, signal);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void onSelect(session);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void onSelect(session)}
      onKeyDown={handleKeyDown}
      className="history-session-row group flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-3 py-3.5 text-left"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium leading-[1.4] text-[var(--text-primary)]">{session.title || historySnippet(session)}</span>
        <span className="text-xs text-[var(--text-muted)]">
          {session.provider && `${session.provider === 'codex' ? 'Codex' : 'Claude Code'} · `}
          {formatShortDateTime(session.last_message_at || session.created_at)}
        </span>
      </div>
      {status && <span className="flex-none text-xs text-primary">{status}</span>}
      {unread && <span className="inline-flex flex-none items-center gap-1.5 text-xs text-primary"><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />Unread</span>}
      <button
        type="button"
        title="Remove from Fuse"
        aria-label="Remove from Fuse"
        onClick={(event) => { event.stopPropagation(); void onDelete(session.id); }}
        className="flex size-7 flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[var(--text-muted)] opacity-0 transition-[opacity,color] focus-visible:opacity-100 disabled:cursor-default disabled:opacity-45 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function EmptyHistory() {
  return (
    <div className="px-6 pb-6 text-center" style={{ paddingTop: 'max(0px, calc(var(--empty-state-anchor) - 5.75rem))' }}>
      <p className="mb-3 text-lg font-semibold text-[var(--text-primary)]">No sessions yet</p>
      <p className="m-0 text-sm leading-[1.55] text-[var(--text-muted)]">Send a message in the chat panel to start an agent session.</p>
    </div>
  );
}

function HistoryResults(props: HistoryModeViewProps & { attention: SessionAttention[] }) {
  const { sessions, attention, actionError, hasMore, nativeRefreshing, loadingMore, selectSession, deleteSession, loadMore } = props;
  return (
    <>
      {actionError && <p className="m-0 text-sm text-[var(--build-error)]">{actionError}</p>}
      {sessions.length > 0 && (
        <div className="history-session-list flex flex-col gap-0.5">
          {sessions.map((session) => (
            <HistorySessionRow
              key={session.id}
              session={session}
              signal={attention.find((entry) => entry.id === session.id)}
              onSelect={selectSession}
              onDelete={deleteSession}
            />
          ))}
        </div>
      )}
      {hasMore && sessions.length > 0 ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-2 block w-full cursor-pointer border-0 bg-transparent p-2.5 text-sm text-[var(--numina-accent)] transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
        >
          {loadingMore ? 'Loading...' : 'Show more'}
        </button>
      ) : sessions.length === 0 && !nativeRefreshing ? <EmptyHistory /> : null}
    </>
  );
}

/** Presentational seam for history state and actions. */
export function HistoryModeView(props: HistoryModeViewProps) {
  const attention = useSessionAttention();
  const { className, readOnly, onNewChat, nativeWarnings, nativeRefreshing, historyError, historyLoading } = props;
  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      <HistoryHeader readOnly={readOnly} onNewChat={onNewChat} />
      <div className="mx-auto w-full max-w-[768px] flex-1 overflow-y-auto px-6 pb-10">
        <p className="mb-4 text-sm text-[var(--text-muted)]">Claude Code and Codex chats from this folder, plus existing Fuse history. Removing a chat here leaves the provider’s saved session untouched.</p>
        {nativeWarnings.map((warning) => <p key={warning} role="status" className="mb-3 text-sm text-[var(--text-muted)]">{warning}</p>)}
        {nativeRefreshing && <p role="status" className="mb-3 text-sm text-[var(--text-muted)]">Checking for more native chats…</p>}
        {historyError ? (
          <p className="m-0 text-sm text-[var(--build-error)]">{historyError}</p>
        ) : historyLoading ? (
          <div className="flex h-full items-center justify-center pb-10">
            <p className="m-0 text-sm text-[var(--text-muted)]" role="status">Loading history…</p>
          </div>
        ) : <HistoryResults {...props} attention={attention} />}
      </div>
    </div>
  );
}
