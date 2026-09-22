import { useAuth } from '@/state/auth';
import Dashboard from '@/pages/Dashboard';

/**
 * Root route. The desktop always has a local user, so `/` is the repositories
 * dashboard; the hosted app's signed-out landing page is gone.
 *
 * Until `/auth/me` answers (`checked` is false) a neutral placeholder is
 * rendered, as on the web: the header hides its user-only links while `user`
 * is null, so painting the dashboard first would make them pop in a moment
 * later. Once checked, the dashboard renders whatever the answer was — there
 * is no signed-out state to fall back to.
 */
export default function Home() {
  const { checked } = useAuth();
  if (!checked) {
    return (
      <div
        className="page-bg flex h-screen w-full items-center justify-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  return <Dashboard />;
}
