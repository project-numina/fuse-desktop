import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboard = vi.hoisted(() => ({ state: { repositories: [] as Record<string, unknown>[], error: null as string | null, loading: false }, load: vi.fn(), loadActivityInBackground: vi.fn(), refreshBackgroundSessions: vi.fn(), reloadDashboardRepositories: vi.fn() }));
const fetchRecentConversations = vi.hoisted(() => vi.fn());
const unregisterRepository = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const bridge = vi.hoisted(() => ({ isDesktop: vi.fn(() => true), pickAndRegisterFolder: vi.fn(), showInFolder: vi.fn() }));
const MockApiError = vi.hoisted(() => class ApiError extends Error { constructor(message: string, public status: number) { super(message); } });
vi.mock('@/state/dashboard', () => ({ useDashboard: () => dashboard, reloadDashboardRepositories: dashboard.reloadDashboardRepositories }));
vi.mock('@/lib/api', () => ({ fetchRecentConversations, unregisterRepository, ApiError: MockApiError }));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: vi.fn() }));
vi.mock('@/lib/display', () => ({ timeAgo: () => 'just now', truncate: (value: string) => value }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }: { to: string | { pathname: string }; children: ReactNode } & Record<string, unknown>) => <a href={typeof to === 'string' ? to : to.pathname} {...props}>{children}</a>, useNavigate: () => navigate }));
vi.mock('@/components/layout/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => null }));
vi.mock('@/desktop/bridge', () => bridge);
import { setFolderActionError } from '@/state/folder-actions';
import Dashboard from '@/pages/Dashboard';

const repository = (name: string, owner = 'numina') => ({ id: name.length, owner, name, description: `${name} description`, updated_at: null, visibility: 'private', weekly_commits: [0, 2], background_sessions: [] });

describe('Dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.isDesktop.mockReturnValue(true);
    Object.assign(dashboard.state, { repositories: [repository('Fuse'), repository('Mathlib', 'leanprover-community')], error: null, loading: false });
    dashboard.load.mockResolvedValue(undefined);
    dashboard.refreshBackgroundSessions.mockResolvedValue(undefined);
    fetchRecentConversations.mockResolvedValue([]);
    bridge.pickAndRegisterFolder.mockResolvedValue({ id: 3, owner: 'home', name: 'proj', visibility: 'private' });
    unregisterRepository.mockResolvedValue(undefined);
    dashboard.reloadDashboardRepositories.mockResolvedValue(undefined);
    setFolderActionError(null);
  });

  it('loads repositories without requesting chat history, then filters by owner or name', async () => {
    render(<Dashboard />);
    await screen.findByRole('heading', { name: 'Repositories' });
    expect(dashboard.load).toHaveBeenCalled(); expect(fetchRecentConversations).not.toHaveBeenCalled(); expect(dashboard.loadActivityInBackground).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Search repositories'), { target: { value: 'leanprover' } });
    expect(screen.getByText('Mathlib')).toBeInTheDocument(); expect(screen.queryByText('Fuse')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search repositories'), { target: { value: 'missing' } });
    expect(screen.getByText('No repositories match “missing”.')).toBeInTheDocument();
  });

  it('opens a folder through the native picker and shows registration errors inline', async () => {
    render(<Dashboard />);
    await screen.findByRole('heading', { name: 'Repositories' });
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => expect(bridge.pickAndRegisterFolder).toHaveBeenCalledOnce());

    bridge.pickAndRegisterFolder.mockRejectedValueOnce(new MockApiError('Folder not found: /nope', 404));
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(await screen.findByText('Folder not found: /nope')).toBeInTheDocument();
  });

  // The native menu and a window drop register folders with no page mounted;
  // the failure they record is rendered here (in the list and empty states).
  it('renders a folder error reported by the shell', async () => {
    setFolderActionError('Folder not found: /dropped');
    const view = render(<Dashboard />);
    expect(await screen.findByText('Folder not found: /dropped')).toBeInTheDocument();
    view.unmount();
    dashboard.state.repositories = [];
    render(<Dashboard />);
    expect(await screen.findByText('Folder not found: /dropped')).toBeInTheDocument();
  });

  it('removes a folder from the list after confirmation and surfaces failures', async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Fuse from list' }));
    expect(screen.getByText('Remove from Fuse? Its workspaces will be forgotten. Files stay on disk.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(unregisterRepository).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fuse from list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removing Fuse from list' }));
    await waitFor(() => expect(unregisterRepository).toHaveBeenCalledWith('numina', 'Fuse'));
    await waitFor(() => expect(dashboard.reloadDashboardRepositories).toHaveBeenCalledOnce());

    unregisterRepository.mockRejectedValueOnce(new MockApiError('Repository not found', 404));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mathlib from list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removing Mathlib from list' }));
    expect(await screen.findByText('Repository not found')).toBeInTheDocument();
  });

  it('offers no removal outside the desktop app', async () => {
    bridge.isDesktop.mockReturnValue(false);
    render(<Dashboard />);
    await screen.findByRole('heading', { name: 'Repositories' });
    expect(screen.queryByRole('button', { name: /from list/ })).not.toBeInTheDocument();
  });

  it('shows the folder path and reveals it in the file manager', async () => {
    dashboard.state.repositories = [{ ...repository('Fuse'), path: '/home/ada/Fuse' }];
    render(<Dashboard />);
    const reveal = await screen.findByRole('button', { name: '/home/ada/Fuse' });
    fireEvent.click(reveal);
    expect(bridge.showInFolder).toHaveBeenCalledWith('/home/ada/Fuse');
    // No hosted-service links anywhere on the page.
    expect(document.querySelector('a[href^="https://github.com"]')).toBeNull();
  });

  it('disables the folder picker outside the desktop app', async () => {
    bridge.isDesktop.mockReturnValue(false);
    render(<Dashboard />);
    expect(await screen.findByRole('button', { name: 'Open folder' })).toBeDisabled();
    expect(screen.getByText('numina/Fuse')).toBeInTheDocument();
  });

  it('keeps chat history off the home page', async () => {
    render(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeInTheDocument();
    expect(screen.queryByText('Recent chats')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading recent chats' })).not.toBeInTheDocument();
    expect(fetchRecentConversations).not.toHaveBeenCalled();
  });

  it('shows onboarding when no folder has been opened', async () => {
    dashboard.state.repositories = []; render(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'Start with a folder.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Read the guide/ })).toHaveAttribute('href', '/guide');
  });

  it('keeps polling active background sessions across refresh cycles', async () => {
    vi.useFakeTimers();
    dashboard.state.repositories = [{
      ...repository('Fuse'),
      background_sessions: [{ id: 'session-1', blueprint_name: 'bp', tier: 'active', background_updates: [], roadblocks: [] }],
    }];
    const view = render(<Dashboard />);
    try {
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(10_000);
      });
      // One immediate hydration after repositories load, then two poll ticks.
      expect(dashboard.refreshBackgroundSessions).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});
