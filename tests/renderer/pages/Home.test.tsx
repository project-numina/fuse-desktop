import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ checked: false, user: null as { github_username: string } | null }));
vi.mock('@/state/auth', () => ({ useAuth: () => auth }));
vi.mock('@/pages/Dashboard', () => ({ default: () => <div>dashboard page</div> }));
import Home from '@/pages/Home';

describe('Home', () => {
  beforeEach(() => {
    auth.checked = false;
    auth.user = null;
  });

  // The header hides its user-only links until `/auth/me` answers; painting
  // the dashboard before that would make them pop in after first paint.
  it('shows a neutral placeholder until the session check resolves', () => {
    render(<Home />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('dashboard page')).not.toBeInTheDocument();
  });

  it('renders the dashboard once checked, with or without a user', () => {
    auth.checked = true;
    auth.user = { github_username: 'ada' };
    const view = render(<Home />);
    expect(screen.getByText('dashboard page')).toBeInTheDocument();
    view.unmount();
    auth.user = null;
    render(<Home />);
    expect(screen.getByText('dashboard page')).toBeInTheDocument();
  });
});
