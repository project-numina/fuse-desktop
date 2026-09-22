import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const dashboard = vi.hoisted(() => ({ state: { repositories: [] as Record<string, unknown>[], error: null, loading: false }, load: vi.fn() }));
const api = vi.hoisted(() => ({ setupRepository: vi.fn(), fetchLean4Tags: vi.fn() }));
const bridge = vi.hoisted(() => ({ isDesktop: vi.fn(() => true), pickAndRegisterFolder: vi.fn() }));
const MockApiError = vi.hoisted(() => class ApiError extends Error { constructor(message: string, public status: number, public rawDetail: unknown = null) { super(message); } });

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useSearchParams: () => [search.params] }));
vi.mock('@/state/dashboard', () => ({ useDashboard: () => dashboard }));
vi.mock('@/lib/api', () => ({ ...api, ApiError: MockApiError }));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: vi.fn() }));
vi.mock('@/components/layout/AppHeader', () => ({ default: ({ breadcrumbs }: { breadcrumbs?: ReactNode }) => <header>{breadcrumbs}</header> }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => null }));
vi.mock('@/desktop/bridge', () => bridge);
import NewProject from '@/pages/NewProject';

const repo = (id: number, name: string) => ({ id, owner: 'home', name, description: null, visibility: 'private' });

describe('NewProject wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.params = new URLSearchParams();
    dashboard.state.repositories = [repo(1, 'alpha'), repo(2, 'beta')];
    dashboard.load.mockImplementation(async () => {});
    api.fetchLean4Tags.mockResolvedValue([{ name: 'v4.25.0' }, { name: 'v4.26.0-rc1' }]);
    api.setupRepository.mockResolvedValue({ default_branch: 'main', module_name: 'Alpha', project_subdir: '', pull_request_url: null, pull_request_number: null });
    bridge.isDesktop.mockReturnValue(true);
  });

  it('starts on the folder step with the registered folders and a native picker', async () => {
    render(<NewProject />);
    expect(screen.getByRole('heading', { name: 'Pick the folder' })).toBeInTheDocument();
    await waitFor(() => expect(dashboard.load).toHaveBeenCalled());
    expect(await screen.findByRole('option', { name: /home\/alpha/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(/^0[12]$/)).toHaveLength(2);
    expect(document.querySelector('a[href^="https://github.com"]')).toBeNull();

    // The bridge helper refreshes the dashboard store before resolving, so
    // the new row is already in the list when the wizard selects it.
    bridge.pickAndRegisterFolder.mockImplementation(async () => {
      dashboard.state.repositories = [...dashboard.state.repositories, repo(3, 'gamma')];
      return repo(3, 'gamma');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(bridge.pickAndRegisterFolder).toHaveBeenCalledOnce());
    expect(await screen.findByRole('option', { name: /home\/gamma/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows picker errors and a cancelled dialog leaves the selection alone', async () => {
    render(<NewProject />);
    await screen.findByRole('option', { name: /home\/alpha/ });
    bridge.pickAndRegisterFolder.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(bridge.pickAndRegisterFolder).toHaveBeenCalled());
    expect(screen.getByRole('option', { name: /home\/alpha/ })).toHaveAttribute('aria-selected', 'true');

    bridge.pickAndRegisterFolder.mockRejectedValueOnce(new MockApiError('Folder not found: /nope', 404));
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    expect(await screen.findByText('Folder not found: /nope')).toBeInTheDocument();
  });

  it('scaffolds the selected folder with the chosen Lean version and opens it', async () => {
    render(<NewProject />);
    fireEvent.click(await screen.findByRole('option', { name: /home\/beta/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Project settings' })).toBeInTheDocument();
    // Module name is pre-filled from the folder name.
    expect(screen.getByLabelText('Module name')).toHaveValue('Beta');
    // Only stable tags are offered.
    expect(await screen.findByRole('option', { name: 'v4.25.0' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'v4.26.0-rc1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'v4.25.0' }));
    fireEvent.change(screen.getByLabelText('Subfolder (optional)'), { target: { value: '/lean/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.setupRepository).toHaveBeenCalledWith('home', 'beta', 'Beta', 'v4.25.0', 'lean'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo/home/beta'));
    expect(dashboard.load).toHaveBeenCalledWith({ force: true });
  });

  it('maps backend validation errors to the form', async () => {
    api.setupRepository.mockRejectedValueOnce(new MockApiError('bad', 409, 'A Lean project already exists at that location.'));
    render(<NewProject />);
    await screen.findByRole('option', { name: /home\/alpha/ });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('A Lean project already exists at that location.')).toBeInTheDocument();
  });

  it('direct mode skips the folder step and returns to the workspace form with title and base', async () => {
    search.params = new URLSearchParams('owner=home&repo=alpha&base=feature&title=My+theorem');
    render(<NewProject />);
    expect(screen.getByRole('heading', { name: 'Project settings' })).toBeInTheDocument();
    expect(screen.queryByText('01')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Module name')).toHaveValue('Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    // The scaffold lands on the checked-out branch: the carried base is never
    // sent, only handed back to the form.
    await waitFor(() => expect(api.setupRepository).toHaveBeenCalledWith('home', 'alpha', 'Alpha', undefined, undefined));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo/home/alpha/blueprint/new?title=My+theorem&base=feature'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(navigate).toHaveBeenCalledWith(-1);
  });
});
