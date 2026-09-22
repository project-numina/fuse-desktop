import { lazy, useEffect, type ReactNode } from 'react';
import {
  createBrowserRouter,
  isRouteErrorResponse,
  Navigate,
  useOutlet,
  useLocation,
  useMatches,
  useRouteError,
  type LoaderFunctionArgs,
} from 'react-router-dom';
import { useAuth } from '@/state/auth';
import { clearApplicationError } from '@/state/app-error';
import { clearFolderActionErrorOnLeave } from '@/state/folder-actions';
import { setDocumentTitle } from '@/lib/document-title';
import AppErrorFallback from '@/components/layout/AppErrorFallback';
import { loadRepositoryPage } from '@/state/repository-page';
import LightweightPageCache from '@/components/layout/LightweightPageCache';

/**
 * Per-route metadata for document titles. `managedTitle` marks routes that set
 * their own title from within the page, so RouteChrome leaves it untouched.
 */
interface RouteHandle {
  title?: string;
  managedTitle?: boolean;
}

/**
 * React Router route table.
 *
 * Every path the desktop keeps is preserved exactly (the blueprint workspace
 * uses a splat for its optional trailing segments), so links built by pages
 * and by the main process (`lastRoute`, menu navigation) resolve unchanged.
 * The hosted app's admin, usage, access-token, feedback, access-request,
 * sign-in, shared-chat and legal routes are gone; unknown paths fall through
 * to `NotFound`.
 *
 * A `BrowserRouter` works because the loopback backend serves the renderer
 * with an SPA fallback, so deep links and reloads land on `index.html`.
 */

// ─── Lazy page modules ──────────────────────────────────────────────────────
const Home = lazy(() => import('@/pages/Home'));
const Account = lazy(() => import('@/pages/Account'));
const Chats = lazy(() => import('@/pages/Chats'));
const ActiveSessions = lazy(() => import('@/pages/ActiveSessions'));
const NewProject = lazy(() => import('@/pages/NewProject'));
const NewBlueprint = lazy(() => import('@/pages/NewBlueprint'));
const Blueprint = lazy(() => import('@/pages/Blueprint'));
const loadRepoPage = () => import('@/pages/Repo');
const Repo = lazy(loadRepoPage);
const NotFound = lazy(() => import('@/pages/NotFound'));

const Guide = lazy(() => import('@/pages/guide/Guide'));
const GuideSetup = lazy(() => import('@/pages/guide/GuideSetup'));
const GuideWorkspace = lazy(() => import('@/pages/guide/GuideWorkspace'));
const GuideBlueprints = lazy(() => import('@/pages/guide/GuideBlueprints'));
const GuideAgents = lazy(() => import('@/pages/guide/GuideAgents'));
const GuidePullRequests = lazy(() => import('@/pages/guide/GuidePullRequests'));
const GuideCapabilities = lazy(() => import('@/pages/guide/GuideCapabilities'));
const GuideTroubleshooting = lazy(() => import('@/pages/guide/GuideTroubleshooting'));

// ─── Guards ──────────────────────────────────────────────────────────────────

function RouteFallback() {
  return (
    <div className="page-bg h-screen w-full" role="status">
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function RouteErrorFallback() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText || `Request failed (${error.status})`
    : error instanceof Error
      ? error.message
      : 'An unexpected application error occurred.';
  return <AppErrorFallback message={message} />;
}

/**
 * Session guard: wait for `/auth/me`, then redirect to `/` when it produced
 * no user. Locally the backend always answers with the local user, so this
 * only ever shows the fallback for the first paint; it stays so every page
 * is guaranteed a non-null `user` once rendered.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, checked } = useAuth();
  if (!checked) return <RouteFallback />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Back-compat: `/dashboard` was the old landing page; the dashboard now
 * renders at `/`. Preserve query + hash.
 */
function DashboardRedirect() {
  const location = useLocation();
  return (
    <Navigate to={{ pathname: '/', search: location.search, hash: location.hash }} replace />
  );
}

/**
 * Clear the global app error (and the dashboard's folder-action error, once
 * the dashboard is left) on every navigation and set `document.title` from
 * the matched route's `title` — unless the route is `managedTitle` (the
 * blueprint page owns its title across tab switches).
 */
function RouteChrome() {
  const location = useLocation();
  const matches = useMatches();

  useEffect(() => {
    clearApplicationError();
    clearFolderActionErrorOnLeave(location.pathname);
    const handle = matches[matches.length - 1]?.handle as
      | RouteHandle
      | undefined;
    if (!handle?.managedTitle) {
      setDocumentTitle(handle?.title ?? null);
    }
  }, [location, matches]);

  return null;
}

/** Root layout: shared Suspense boundary for lazily-loaded page stubs. */
function Root() {
  const page = useOutlet();
  const { pathname } = useLocation();
  const { user } = useAuth();
  // Explicit allowlist: these routes do not own workspace sessions or editors.
  const pageKey = pathname === '/account' || pathname === '/guide' || pathname.startsWith('/guide/')
    ? pathname : null;
  return (
    <>
      <RouteChrome />
      <LightweightPageCache key={user?.github_username ?? 'anonymous'} pageKey={pageKey} page={page} fallback={<RouteFallback />} />
    </>
  );
}

/**
 * Keep the current route painted while the repository data and page bundle
 * load. React Router does not commit the destination route until this promise
 * settles, which prevents the empty-workspaces state from flashing during a
 * dashboard-to-repository navigation.
 */
async function repositoryLoader({ params }: LoaderFunctionArgs): Promise<null> {
  const owner = params.owner ?? '';
  const repo = params.repo ?? '';
  await Promise.all([loadRepositoryPage(owner, repo), loadRepoPage()]);
  return null;
}

// ─── Route table ─────────────────────────────────────────────────────────────

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteErrorFallback />,
    children: [
      // ─── Dashboard ──────────────────────────────────────────────────────────
      { path: '/', element: <Home /> },
      { path: '/dashboard', element: <DashboardRedirect /> },

      // ─── Pages ──────────────────────────────────────────────────────────────
      { path: '/account', element: <RequireAuth><Account /></RequireAuth>, handle: { title: 'Settings' } },
      { path: '/chats', element: <RequireAuth><Chats /></RequireAuth>, handle: { title: 'Chats' } },
      { path: '/sessions', element: <RequireAuth><ActiveSessions /></RequireAuth>, handle: { title: 'Active sessions' } },
      { path: '/new', element: <RequireAuth><NewProject /></RequireAuth>, handle: { title: 'New project' } },

      // ─── Guide routes ───────────────────────────────────────────────────────
      { path: '/guide', element: <RequireAuth><Guide /></RequireAuth>, handle: { title: 'Guide' } },
      { path: '/guide/setup', element: <RequireAuth><GuideSetup /></RequireAuth>, handle: { title: 'Setup guide' } },
      { path: '/guide/workspace', element: <RequireAuth><GuideWorkspace /></RequireAuth>, handle: { title: 'Workspace guide' } },
      { path: '/guide/blueprints', element: <RequireAuth><GuideBlueprints /></RequireAuth>, handle: { title: 'Blueprint guide' } },
      { path: '/guide/agents', element: <RequireAuth><GuideAgents /></RequireAuth>, handle: { title: 'Agent guide' } },
      { path: '/guide/pull-requests', element: <RequireAuth><GuidePullRequests /></RequireAuth>, handle: { title: 'Commits guide' } },
      { path: '/guide/capabilities', element: <RequireAuth><GuideCapabilities /></RequireAuth>, handle: { title: 'Capabilities guide' } },
      { path: '/guide/troubleshooting', element: <RequireAuth><GuideTroubleshooting /></RequireAuth>, handle: { title: 'Troubleshooting guide' } },

      // ─── Repository / blueprint routes ──────────────────────────────────────
      {
        path: '/repo/:owner/:repo',
        loader: repositoryLoader,
        element: <RequireAuth><Repo /></RequireAuth>,
        handle: { title: 'Repository' },
      },
      { path: '/repo/:owner/:repo/blueprint/new', element: <RequireAuth><NewBlueprint /></RequireAuth>, handle: { title: 'New workspace' } },
      // The workspace manages its own document title across :mode? tab switches.
      {
        path: '/repo/:owner/:repo/blueprint/:blueprintId/:mode?/*',
        element: <RequireAuth><Blueprint /></RequireAuth>,
        handle: { managedTitle: true },
      },

      // ─── Catch-all ──────────────────────────────────────────────────────────
      { path: '*', element: <NotFound />, handle: { title: 'Not found' } },
    ],
  },
]);

export default router;
