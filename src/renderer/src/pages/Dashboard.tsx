import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FolderOpen, X } from 'lucide-react';

import { reloadDashboardRepositories, useDashboard, type Repository } from '@/state/dashboard';
import {
  folderActionErrorMessage,
  OPEN_FOLDER_FALLBACK,
  setFolderActionError,
  useFolderActionError,
} from '@/state/folder-actions';
import { unregisterRepository } from '@/lib/api';
import { setDocumentTitle } from '@/lib/document-title';
import { timeAgo } from '@/lib/display';
import { Input } from '@/components/ui/input';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import { isDesktop, pickAndRegisterFolder, showInFolder } from '@/desktop/bridge';

/** Opened folders, their activity, and the Open folder action. */

const DASHBOARD_REFRESH_INTERVAL_MS = 5000;

interface SparklinePaths {
  area: string;
  line: string;
}

/**
 * Builds the area + line `<path>` `d` attributes for a repository's weekly
 */
function sparklinePaths(weeklyCommits: number[]): SparklinePaths {
  if (!weeklyCommits || weeklyCommits.length === 0) return { area: '', line: '' };
  const max = Math.max(...weeklyCommits, 1);
  const width = 155;
  const height = 30;
  const baseline = height - 1;
  const step = width / (weeklyCommits.length - 1 || 1);

  const points = weeklyCommits.map((value, index) => {
    const x = index * step;
    const y = baseline - (value / max) * (baseline - 2);
    return { x, y };
  });

  const lineD = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
    .join(' ');
  const areaD = `${lineD} L${width},${baseline} L0,${baseline} Z`;

  return { area: areaD, line: lineD };
}

function repositoryPath(repository: Repository): string {
  return `/repo/${repository.owner}/${repository.name}`;
}

/**
 * "Open folder" CTA: native folder picker → register → refresh the list.
 *
 * Errors from registration (not a folder, unreadable) go to the shared
 * folder-action store so the list shows them inline — the same line the
 * native menu and a window drop report their failures on.
 */
function OpenFolderButton({ prominent = false }: { prominent?: boolean }) {
  const [busy, setBusy] = useState(false);
  const enabled = isDesktop();

  async function openFolder() {
    if (busy) return;
    setBusy(true);
    setFolderActionError(null);
    try {
      await pickAndRegisterFolder();
    } catch (caught) {
      setFolderActionError(folderActionErrorMessage(caught, OPEN_FOLDER_FALLBACK));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={prominent
        ? 'inline-flex cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-foreground bg-foreground px-5 py-2.5 text-sm font-medium text-background shadow-sm transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-50'
        : 'btn-outline-accent px-4 py-1.5'}
      disabled={!enabled || busy}
      title={enabled ? undefined : 'Available in the desktop app.'}
      onClick={() => void openFolder()}
    >
      {prominent && <FolderOpen size={17} strokeWidth={1.7} aria-hidden="true" />}
      {busy ? 'Opening…' : 'Open folder'}
    </button>
  );
}

/** Shared "Repositories" heading + Open folder action used by every state. */
function RepositoriesHeader() {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <h2 className="text-2xl font-bold text-foreground">Repositories</h2>
      <OpenFolderButton />
    </div>
  );
}

const REMOVE_FOLDER_FALLBACK = 'Could not remove that folder from the list. Please try again.';

/**
 * "Remove from list": forget a folder Fuse was pointed at (desktop-only; the
 * backend exposes `DELETE /repositories/:owner/:repo`). Nothing on disk is
 * touched, but the workspaces Fuse created there are forgotten too, so the
 * first click only asks; the second removes.
 */
function RemoveRepositoryButton({ repository }: { repository: Repository }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setFolderActionError(null);
    try {
      await unregisterRepository(repository.owner, repository.name);
      await reloadDashboardRepositories();
    } catch (caught) {
      setFolderActionError(folderActionErrorMessage(caught, REMOVE_FOLDER_FALLBACK));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const linkClass =
    'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-[var(--text-body)] transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muted-foreground disabled:cursor-default disabled:opacity-60';

  if (!confirming) {
    return (
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent px-0 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muted-foreground"
        title="Remove this folder from the list. Nothing on disk is deleted."
        aria-label={`Remove ${repository.name} from list`}
        onClick={() => setConfirming(true)}
      >
        <X size={12} aria-hidden="true" />
        Remove
      </button>
    );
  }
  return (
    <span className="flex max-w-[220px] flex-wrap justify-end gap-2 text-xs text-[var(--text-body)]">
      <span className="w-full text-right leading-5">Remove from Fuse? Its workspaces will be forgotten. Files stay on disk.</span>
      <button
        type="button"
        className={`${linkClass} font-medium text-destructive hover:text-destructive`}
        disabled={busy}
        aria-label={`Confirm removing ${repository.name} from list`}
        onClick={() => void remove()}
      >
        {busy ? 'Removing…' : 'Remove'}
      </button>
      <button
        type="button"
        className={linkClass}
        disabled={busy}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
    </span>
  );
}

// ─── Onboarding empty state ──────────────────────────────────────────────────

function EmptyRepositoryIllustration() {
  return (
    <svg viewBox="0 0 240 160" className="h-40 w-60 text-foreground" fill="none" aria-hidden="true">
      <ellipse cx="120" cy="146" rx="69" ry="3" fill="currentColor" opacity=".04" />
      <path d="M48 104V64a7 7 0 0 1 7-7h35a8 8 0 0 1 6 3l7 8h82a7 7 0 0 1 7 7v29Z" fill="var(--muted)" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.4" strokeLinejoin="round" />
      <g transform="rotate(-6 91 77)">
        <rect x="61" y="23" width="69" height="109" rx="5" fill="var(--card)" stroke="currentColor" strokeOpacity=".32" strokeWidth="1.4" />
        <path d="M74 37h21m-21 6h35" stroke="currentColor" strokeOpacity=".2" strokeLinecap="round" />
        <text x="73" y="68" fill="currentColor" opacity=".65" fontFamily="Georgia, serif" fontSize="16" fontStyle="italic">x² ≥ 0</text>
        <path d="M74 80h38m-38 6h25" stroke="currentColor" strokeOpacity=".18" strokeLinecap="round" />
      </g>
      <g transform="rotate(6 155 85)">
        <rect x="125" y="37" width="57" height="95" rx="5" fill="var(--card)" stroke="currentColor" strokeOpacity=".32" strokeWidth="1.4" />
        <path d="m141 54-5 5 5 5m24-10 5 5-5 5m-10-13-4 16" stroke="currentColor" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M137 77h9m5 0h18m-28 6h20m-24 6h13" stroke="currentColor" strokeOpacity=".22" strokeLinecap="round" />
      </g>
      <path d="M43 94h154l-9 42a8 8 0 0 1-8 6H60a8 8 0 0 1-8-6Z" fill="var(--card)" />
      <path d="M43 94h154l-9 42a8 8 0 0 1-8 6H60a8 8 0 0 1-8-6Z" fill="currentColor" fillOpacity=".025" stroke="currentColor" strokeOpacity=".4" strokeWidth="1.4" strokeLinejoin="round" />
      <rect x="66" y="111" width="24" height="7" rx="2" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.2" />
    </svg>
  );
}

function GettingStarted() {
  const folderError = useFolderActionError();
  return (
    <div className="mx-auto mt-2 w-full max-w-[56rem] p-6">
      <div className="mb-7 flex items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Repositories</h2>
      </div>
      {folderError && <p role="alert" className="mb-4 text-sm text-destructive">{folderError}</p>}
      <section aria-labelledby="empty-repositories-title" className="flex flex-col items-center rounded-[14px] border border-border bg-card px-6 pt-9 pb-10 text-center sm:pt-12 sm:pb-12">
        <EmptyRepositoryIllustration />
        <h3 id="empty-repositories-title" className="mt-5 text-[1.625rem] font-semibold tracking-[-0.035em] text-foreground">Start with a folder.</h3>
        <p className="mt-3 max-w-[340px] text-sm leading-6 text-[var(--text-body)]">
          Open a Lean project, or start from an empty folder. This is where your work will live.
        </p>
        <div className="mt-6"><OpenFolderButton prominent /></div>
        <p className="mt-3 text-xs text-muted-foreground">You can also drop a folder into this window.</p>
      </section>
      <div className="mt-5 flex flex-col items-start justify-between gap-3 px-1 text-xs sm:flex-row sm:items-center">
        <p className="text-muted-foreground">Next: add a LaTeX blueprint and work with an agent in Lean.</p>
        <Link to="/guide" className="inline-flex shrink-0 items-center gap-1.5 font-medium text-[var(--text-body)] underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground">
          Read the guide <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

// ─── Repository listing ──────────────────────────────────────────────────────

function RepositoryRow({ repository }: { repository: Repository }) {
  const paths = useMemo(
    () => sparklinePaths(repository.weekly_commits),
    [repository.weekly_commits],
  );
  const isPrivate = repository.visibility === 'private';
  // Folder path when the backend includes it; the route identity otherwise.
  const location = repository.path ?? `${repository.owner}/${repository.name}`;

  return (
    <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[color:var(--numina-border-light)] py-6">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <Link
            to={repositoryPath(repository)}
            className="cursor-pointer text-lg font-semibold leading-[1.5] text-primary no-underline hover:underline"
          >
            {repository.name}
          </Link>
          <span className="rounded-full border border-[color:var(--numina-border)] px-[0.4375rem] py-[0.0625rem] text-xs font-medium leading-[1.5] text-[color:var(--gray-500)]">
            {isPrivate ? 'Private' : 'Public'}
          </span>
        </div>

        {repository.path && isDesktop() ? (
          <button
            type="button"
            className="mb-2.5 block max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-left font-mono text-sm leading-[1.5] text-[color:var(--gray-600)] hover:underline"
            title="Show in folder"
            onClick={(event) => {
              event.stopPropagation();
              showInFolder(repository.path as string);
            }}
          >
            {location}
          </button>
        ) : (
          <span
            className="mb-2.5 block max-w-full truncate font-mono text-sm leading-[1.5] text-[color:var(--gray-600)]"
            title={location}
          >
            {location}
          </span>
        )}

        {repository.description && (
          <p className="mb-2 text-[0.8125rem] leading-[1.4] text-[color:var(--gray-600)]">
            {repository.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-[color:var(--gray-600)]">
          {repository.updated_at && <span>Updated {timeAgo(repository.updated_at)}</span>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-4">
        {isDesktop() && <RemoveRepositoryButton repository={repository} />}
        {repository.weekly_commits && repository.weekly_commits.length > 0 && (
          <svg
            className="h-[35px] w-[175px]"
            viewBox="0 0 155 30"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={paths.area} className="fill-[#2da44e] opacity-15" />
            <path
              d={paths.line}
              className="fill-none stroke-[#2da44e] opacity-80 [stroke-width:1.5]"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

function RepositoryList({ repositories }: { repositories: Repository[] }) {
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const folderError = useFolderActionError();

  const filteredRepositories = useMemo(() => {
    const query = repoSearchQuery.trim().toLowerCase();
    if (!query) return repositories;
    return repositories.filter(
      (repository) =>
        repository.name.toLowerCase().includes(query) ||
        repository.owner.toLowerCase().includes(query),
    );
  }, [repositories, repoSearchQuery]);

  return (
    <div className="min-w-0">
      <RepositoriesHeader />
      {folderError && <p className="mb-4 text-sm text-destructive">{folderError}</p>}

      <Input
        type="text"
        className="mb-4 h-auto rounded-md border-[color:var(--numina-border)] bg-[var(--numina-card-bg)] px-3 py-2 text-sm focus-visible:border-[color:var(--numina-accent)] focus-visible:ring-0 dark:bg-[var(--numina-card-bg)]"
        value={repoSearchQuery}
        onChange={(event) => setRepoSearchQuery(event.target.value)}
        placeholder="Search repositories…"
        aria-label="Search repositories"
        autoComplete="off"
        spellCheck={false}
      />

      {filteredRepositories.length === 0 ? (
        <p className="px-1 py-6 text-sm text-muted-foreground">
          No repositories match “{repoSearchQuery}”.
        </p>
      ) : (
        <div className="border-t border-[color:var(--numina-border-light)]">
          {filteredRepositories.map((repository) => (
            <RepositoryRow
              key={`${repository.owner}/${repository.name}`}
              repository={repository}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { state, load, loadActivityInBackground, refreshBackgroundSessions } = useDashboard();
  const { repositories, error, loading } = state;

  useEffect(() => {
    setDocumentTitle('Repositories');
  }, []);

  // Load folder activity without blocking the initial folder listing.
  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
      loadActivityInBackground();
      void refreshBackgroundSessions();
    });
    return () => {
      cancelled = true;
    };
  }, [load, loadActivityInBackground, refreshBackgroundSessions]);

  // While any repository has an active background session, poll only its
  // lightweight DB-backed cards. Each refresh changes repositories identity to
  // schedule the next render, and polling stops once no active sessions remain.
  const hasActiveBackgroundSessions = useMemo(
    () =>
      repositories.some((repository) =>
        repository.background_sessions.some((session) => session.tier === 'active'),
      ),
    [repositories],
  );

  useEffect(() => {
    if (!hasActiveBackgroundSessions) return;
    const timer = setInterval(() => {
      void refreshBackgroundSessions();
    }, DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActiveBackgroundSessions, refreshBackgroundSessions]);

  return (
    <div className="page-bg flex h-screen flex-col overflow-y-auto">
      <AppHeader />

      <main className="w-full flex-1">
        {loading ? (
          <div
            className="mx-auto w-full max-w-[64rem] px-6 py-6 md:px-12"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="min-w-0 animate-pulse">
              <div className="mb-6 h-8 w-40 rounded-md bg-muted" />
              <div className="mb-4 h-9 w-full rounded-md bg-muted" />
              <div className="space-y-5 border-t border-[color:var(--numina-border-light)] pt-6">
                <div className="h-20 rounded-md bg-muted" />
                <div className="h-20 rounded-md bg-muted" />
                <div className="h-20 rounded-md bg-muted" />
              </div>
            </div>
            <span className="sr-only">Loading repositories…</span>
          </div>
        ) : error ? (
          <div className="mx-auto w-full max-w-[56rem] px-6 py-12 text-center text-sm text-destructive">
            {error}
          </div>
        ) : repositories.length === 0 ? (
          <GettingStarted />
        ) : (
          <div className="mx-auto w-full max-w-[64rem] px-6 py-6 md:px-12">
            <RepositoryList repositories={repositories} />
          </div>
        )}
      </main>

      <AppFooter />
    </div>
  );
}
