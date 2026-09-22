import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const navigate = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ state: { repository: { name: 'Fuse', owner: 'numina', description: 'Formalization', path: null as string | null }, blueprints: [{ id: 'bp-1', name: 'First theorem', updated_at: null, can_edit: true }], pullRequests: [], error: null }, load: vi.fn() }));
const bridge = vi.hoisted(() => ({ isDesktop: vi.fn(() => true), showInFolder: vi.fn() }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode } & Record<string, unknown>) => <a href={to} {...props}>{children}</a>, useNavigate: () => navigate, useParams: () => ({ owner: 'numina', repo: 'fuse' }) }));
vi.mock('@/state/repository-page', () => ({ useRepositoryPage: () => store }));
vi.mock('@/hooks/use-status', () => ({ useStatus: () => ({ pullRequestStatusLabel: (value: string) => value }) }));
vi.mock('@/lib/api', () => ({ deleteBlueprint: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: vi.fn() }));
vi.mock('@/lib/display', () => ({ timeAgo: () => 'now' }));
vi.mock('@/components/layout/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => null }));
vi.mock('@/desktop/bridge', () => bridge);
import Repo from '@/pages/Repo';

describe('Repository page', () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); store.state.blueprints[0].can_edit = true; store.state.repository.path = null; bridge.isDesktop.mockReturnValue(true); });
  it('loads route data and navigates to workspace creation', () => {
    render(<Repo />); expect(store.load).toHaveBeenCalledWith('numina', 'fuse');
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(navigate).toHaveBeenCalledWith('/repo/numina/fuse/blueprint/new');
  });
  it('stages deletion in session storage and supports undo', () => {
    render(<Repo />); fireEvent.click(screen.getByTitle('Delete blueprint'));
    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('pendingBlueprintDelete') ?? '{}')).toEqual({ owner: 'numina', repo: 'fuse', ids: ['bp-1'] });
    fireEvent.click(screen.getByTitle('Undo delete'));
    expect(screen.queryByText('Deleted')).not.toBeInTheDocument(); expect(sessionStorage.getItem('pendingBlueprintDelete')).toBeNull();
  });
  it('flushes pending deletes with keepalive requests when leaving the page', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const view = render(<Repo />);
      fireEvent.click(screen.getByTitle('Delete blueprint'));
      view.unmount();
      expect(fetchMock).toHaveBeenCalledWith('/api/repositories/numina/fuse/blueprints/bp-1', { method: 'DELETE', credentials: 'include', keepalive: true });
      expect(sessionStorage.getItem('pendingBlueprintDelete')).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('hides deletion for a read-only workspace', () => {
    store.state.blueprints[0].can_edit = false;
    render(<Repo />);
    expect(screen.queryByTitle('Delete blueprint')).not.toBeInTheDocument();
  });
  it('shows the route identity as plain text and the folder path as a reveal button', () => {
    render(<Repo />);
    expect(screen.getByText('numina/Fuse')).toBeInTheDocument();
    expect(document.querySelector('a[href^="https://"]')).toBeNull();
    store.state.repository.path = 'C:\\Users\\ada\\Fuse';
    render(<Repo />);
    fireEvent.click(screen.getByRole('button', { name: 'C:\\Users\\ada\\Fuse' }));
    expect(bridge.showInFolder).toHaveBeenCalledWith('C:\\Users\\ada\\Fuse');
  });
});
