import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    user: { github_username: 'ada' } as { github_username: string } | null,
    checked: true,
  },
  loadRepositoryPage: vi.fn(async () => undefined),
  clearApplicationError: vi.fn(),
  clearFolderActionErrorOnLeave: vi.fn(),
  setDocumentTitle: vi.fn(),
  pageCache: vi.fn(),
  appErrorFallback: vi.fn(),
}));

vi.mock('@/state/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/state/repository-page', () => ({
  loadRepositoryPage: mocks.loadRepositoryPage,
}));
vi.mock('@/state/app-error', () => ({
  clearApplicationError: mocks.clearApplicationError,
}));
vi.mock('@/state/folder-actions', () => ({
  clearFolderActionErrorOnLeave: mocks.clearFolderActionErrorOnLeave,
}));
vi.mock('@/lib/document-title', () => ({ setDocumentTitle: mocks.setDocumentTitle }));
vi.mock('@/components/layout/AppErrorFallback', () => ({
  default: ({ message }: { message: string }) => {
    mocks.appErrorFallback(message);
    return <div role="alert">{message}</div>;
  },
}));
vi.mock('@/components/layout/LightweightPageCache', async () => {
  const React = await import('react');
  return {
    default: (props: { pageKey: string | null; page: ReactNode; fallback: ReactNode }) => {
      mocks.pageCache(props);
      return React.createElement(React.Suspense, { fallback: props.fallback }, props.page);
    },
  };
});

vi.mock('@/pages/Home', () => ({ default: () => <h1>Home page</h1> }));
vi.mock('@/pages/Account', () => ({ default: () => <h1>Account page</h1> }));
vi.mock('@/pages/Chats', () => ({ default: () => <h1>Chats page</h1> }));
vi.mock('@/pages/ActiveSessions', () => ({ default: () => <h1>Active sessions page</h1> }));
vi.mock('@/pages/NewProject', () => ({ default: () => <h1>New project page</h1> }));
vi.mock('@/pages/NewBlueprint', () => ({ default: () => <h1>New workspace page</h1> }));
vi.mock('@/pages/Blueprint', () => ({ default: () => <h1>Blueprint workspace</h1> }));
vi.mock('@/pages/Repo', () => ({ default: () => <h1>Repository page</h1> }));
vi.mock('@/pages/NotFound', () => ({ default: () => <h1>Missing page</h1> }));
vi.mock('@/pages/guide/Guide', () => ({ default: () => <h1>Guide page</h1> }));
vi.mock('@/pages/guide/GuideSetup', () => ({ default: () => <h1>Setup guide page</h1> }));
vi.mock('@/pages/guide/GuideWorkspace', () => ({ default: () => <h1>Workspace guide page</h1> }));
vi.mock('@/pages/guide/GuideBlueprints', () => ({ default: () => <h1>Blueprint guide page</h1> }));
vi.mock('@/pages/guide/GuideAgents', () => ({ default: () => <h1>Agent guide page</h1> }));
vi.mock('@/pages/guide/GuidePullRequests', () => ({ default: () => <h1>Commits guide page</h1> }));
vi.mock('@/pages/guide/GuideCapabilities', () => ({ default: () => <h1>Capabilities guide page</h1> }));
vi.mock('@/pages/guide/GuideTroubleshooting', () => ({ default: () => <h1>Troubleshooting guide page</h1> }));

import router from '@/router';

const children = router.routes[0].children ?? [];

async function renderRoute(path: string) {
  await router.navigate(path);
  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  mocks.auth.user = { github_username: 'ada' };
  mocks.auth.checked = true;
  mocks.loadRepositoryPage.mockResolvedValue(undefined);
  await router.navigate('/');
  vi.clearAllMocks();
});

describe('router parity', () => {
  it('keeps every desktop path and drops the hosted-only ones', () => {
    expect(children.map((route) => route.path)).toEqual([
      '/', '/dashboard', '/account', '/chats', '/sessions', '/new',
      '/guide', '/guide/setup', '/guide/workspace', '/guide/blueprints', '/guide/agents',
      '/guide/pull-requests', '/guide/capabilities', '/guide/troubleshooting',
      '/repo/:owner/:repo', '/repo/:owner/:repo/blueprint/new',
      '/repo/:owner/:repo/blueprint/:blueprintId/:mode?/*', '*',
    ]);
    for (const gone of ['/admin', '/usage', '/access-tokens', '/feedback', '/privacy', '/terms', '/login-error']) {
      expect(children.find((route) => route.path === gone)).toBeUndefined();
    }
  });

  it('preloads repository state and its lazy module before committing the route', async () => {
    const route = children.find((candidate) => candidate.path === '/repo/:owner/:repo');
    expect(route?.loader).toBeTypeOf('function');
    const loader = route?.loader;
    if (typeof loader !== 'function') throw new Error('repository loader missing');

    await expect(loader({
      params: { owner: 'a b', repo: 'c' },
      request: new Request('https://test/repo'),
      context: undefined,
    } as never)).resolves.toBeNull();

    expect(mocks.loadRepositoryPage).toHaveBeenCalledWith('a b', 'c');

    mocks.loadRepositoryPage.mockClear();
    await loader({
      params: {}, request: new Request('https://test/repo'), context: undefined,
    } as never);
    expect(mocks.loadRepositoryPage).toHaveBeenCalledWith('', '');
  });

  it('marks only the blueprint workspace as owning its document title', () => {
    const workspace = children.find((candidate) => candidate.path?.includes(':blueprintId'));
    expect(workspace?.handle).toEqual({ managedTitle: true });
    expect(children.find((candidate) => candidate.path === '/account')?.handle).toEqual({ title: 'Settings' });
  });
});

describe('router rendering', () => {
  it('renders lazy authenticated pages and applies route chrome', async () => {
    const view = await renderRoute('/sessions');

    expect(await screen.findByRole('heading', { name: 'Active sessions page' })).toBeVisible();
    await waitFor(() => {
      expect(mocks.clearApplicationError).toHaveBeenCalled();
      expect(mocks.clearFolderActionErrorOnLeave).toHaveBeenCalledWith('/sessions');
      expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Active sessions');
    });
    expect(mocks.pageCache).toHaveBeenLastCalledWith(expect.objectContaining({ pageKey: null }));
    view.unmount();
  });

  it('uses page caching only for allowlisted settings and guide routes', async () => {
    const account = await renderRoute('/account');
    expect(await screen.findByRole('heading', { name: 'Account page' })).toBeVisible();
    expect(mocks.pageCache).toHaveBeenLastCalledWith(expect.objectContaining({ pageKey: '/account' }));
    account.unmount();

    vi.clearAllMocks();
    const guide = await renderRoute('/guide/setup');
    expect(await screen.findByRole('heading', { name: 'Setup guide page' })).toBeVisible();
    expect(mocks.pageCache).toHaveBeenLastCalledWith(expect.objectContaining({ pageKey: '/guide/setup' }));
    guide.unmount();
  });

  it.each([
    ['/chats', 'Chats page'],
    ['/new', 'New project page'],
    ['/guide', 'Guide page'],
    ['/guide/workspace', 'Workspace guide page'],
    ['/guide/blueprints', 'Blueprint guide page'],
    ['/guide/agents', 'Agent guide page'],
    ['/guide/pull-requests', 'Commits guide page'],
    ['/guide/capabilities', 'Capabilities guide page'],
    ['/guide/troubleshooting', 'Troubleshooting guide page'],
    ['/repo/acme/mathlib/blueprint/new', 'New workspace page'],
  ])('resolves the lazy page for %s', async (path, heading) => {
    const view = await renderRoute(path);

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    view.unmount();
  });

  it('shows the loading fallback while authentication is unchecked', async () => {
    mocks.auth.checked = false;
    const view = await renderRoute('/account');

    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('heading', { name: 'Account page' })).not.toBeInTheDocument();
    view.unmount();
  });

  it('redirects protected routes home when there is no authenticated user', async () => {
    mocks.auth.user = null;
    const view = await renderRoute('/chats');

    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
    view.unmount();
  });

  it('preserves query parameters and the hash in the dashboard compatibility redirect', async () => {
    const view = await renderRoute('/dashboard?tab=recent#today');

    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeVisible();
    expect(router.state.location).toMatchObject({
      pathname: '/', search: '?tab=recent', hash: '#today',
    });
    view.unmount();
  });

  it('leaves the document title untouched for blueprint workspaces', async () => {
    const view = await renderRoute('/repo/acme/mathlib/blueprint/fermat/edit/source.tex');

    expect(await screen.findByRole('heading', { name: 'Blueprint workspace' })).toBeVisible();
    await waitFor(() => expect(mocks.clearApplicationError).toHaveBeenCalled());
    expect(mocks.setDocumentTitle).not.toHaveBeenCalled();
    view.unmount();
  });

  it('renders repository data after the loader and lazy page resolve', async () => {
    const view = await renderRoute('/repo/acme/mathlib');

    expect(await screen.findByRole('heading', { name: 'Repository page' })).toBeVisible();
    expect(mocks.loadRepositoryPage).toHaveBeenCalledWith('acme', 'mathlib');
    expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Repository');
    view.unmount();
  });

  it('renders the catch-all page and its title for unknown paths', async () => {
    const view = await renderRoute('/does/not/exist');

    expect(await screen.findByRole('heading', { name: 'Missing page' })).toBeVisible();
    expect(mocks.setDocumentTitle).toHaveBeenCalledWith('Not found');
    view.unmount();
  });

  it.each([
    [new Error('Repository exploded'), 'Repository exploded'],
    [null, 'An unexpected application error occurred.'],
  ])('renders a useful error boundary message for failed loaders', async (failure, message) => {
    mocks.loadRepositoryPage.mockRejectedValueOnce(failure);
    const view = await renderRoute('/repo/acme/broken');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mocks.appErrorFallback).toHaveBeenCalledWith(message);
    view.unmount();
  });

  it.each([
    [new Response(null, { status: 503, statusText: 'Service asleep' }), 'Service asleep'],
    [new Response(null, { status: 502 }), 'Request failed (502)'],
  ])('formats route response failures', async (failure, message) => {
    mocks.loadRepositoryPage.mockRejectedValueOnce(
      failure,
    );
    const view = await renderRoute('/repo/acme/asleep');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    view.unmount();
  });
});
