import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeanSetupStatus } from '@shared/lean-setup';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/api', () => ({ request: mocks.request }));
import LeanSetupPrompt from '@/desktop/LeanSetupPrompt';
import { OPEN_LEAN_SETUP_EVENT } from '@/lib/lean-setup-events';
import { request as realRequest } from '@/lib/api/core';

let status: LeanSetupStatus;
let repositoryId = 0;
beforeEach(() => {
  mocks.request.mockReset();
  status = {
    repositoryId: ++repositoryId, dismissed: false, threads: 2, task: null,
    projects: [{ directory: 'lean/kakeya', ready: false, storage: { availableBytes: 120e9, totalBytes: 500e9 } }],
  };
  mocks.request.mockImplementation(async (_path: string, options?: RequestInit) => options?.method === 'POST' ? { ok: true } : status);
});
afterEach(() => vi.unstubAllGlobals());

describe('LeanSetupPrompt', () => {
  it('uses the shared outlined pill button and opens confirmation without building', async () => {
    status.dismissed = true;
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    const action = await screen.findByRole('button', { name: 'Set up Lean' });
    expect(action).toHaveClass('group/button', 'rounded-full', 'justify-center', 'bg-transparent', 'border-primary/50');
    expect(action.querySelector('svg')).toBeNull();
    expect(action.parentElement).not.toHaveClass('border-t', 'fixed');
    expect(screen.queryByText('Lean checking off')).not.toBeInTheDocument();
    fireEvent.click(action);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Disk space');
    expect(mocks.request.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });
  it('uses the real API client with exactly one /api prefix', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(status), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    mocks.request.mockImplementation(realRequest);
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await screen.findByRole('dialog');
    expect(fetch).toHaveBeenCalledWith('/api/repositories/local/math/blueprints/workspace/lean/setup', expect.any(Object));
  });
  it('offers setup with disk capacity without starting any work', async () => {
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Set up Lean');
    expect(screen.getByText('120 GB available')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '120 GB available of 500 GB');
    expect(screen.getByText(/No reliable size estimate/)).toBeInTheDocument();
    expect(mocks.request.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });

  it('focuses the dialog without restoring the orange disclosure focus ring', async () => {
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    const summary = screen.getByText('About setup');
    expect(summary).not.toHaveFocus();
    expect(summary).toHaveClass('outline-none', 'focus-visible:underline');
    expect(summary.className).not.toMatch(/focus-visible:ring/);
    summary.focus();
    expect(summary).toHaveFocus();
  });

  it('does not prompt for an already prepared repository', async () => {
    status.projects[0].ready = true;
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Set up Lean' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('persists opt-out only when requested and keeps a manual entry point', async () => {
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/repositories/local/math/blueprints/workspace/lean/setup/preference', expect.objectContaining({ body: '{"dismissed":true}' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Set up Lean' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does not repeat a normal dismissal during this application session', async () => {
    const view = render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    view.unmount();
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await screen.findByRole('button', { name: 'Set up Lean' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });

  it('honors a saved opt-out, including on a fresh session', async () => {
    status.dismissed = true;
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await screen.findByRole('button', { name: 'Set up Lean' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('starts only the workspace project and exposes cancellation', async () => {
    status.projects = [{ directory: 'lean/other', ready: false, storage: null }];
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lean project:/ })).not.toBeInTheDocument();
    expect(screen.getByText('Available disk space could not be read.')).toBeInTheDocument();
    status = { ...status, task: { directory: 'lean/other', status: 'running', message: 'Building', steps: ['Building'] } };
    fireEvent.click(screen.getByRole('button', { name: 'Set up Lean' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/repositories/local/math/blueprints/workspace/lean/setup', { method: 'POST' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/repositories/local/math/blueprints/workspace/lean/setup/cancel', { method: 'POST' }));
  });

  it('warns about low space and keeps failures actionable', async () => {
    status.projects[0].storage!.availableBytes = 2e9;
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await screen.findByRole('dialog');
    expect(screen.getByText(/Less than 5 GB/)).toBeInTheDocument();
    mocks.request.mockRejectedValueOnce(new Error('Build unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Set up Lean' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Build unavailable');
    expect(screen.getByRole('button', { name: 'Set up Lean' })).toBeEnabled();
  });

  it('contains long paths and keeps actions outside the scrolling body', async () => {
    const directory = `apps/fuse/clones/${'nested-project/'.repeat(18)}kakeya`;
    status.projects = [{ ...status.projects[0], directory }];
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('flex', 'min-w-0', 'overflow-hidden');
    expect(screen.queryByRole('button', { name: /Lean project:/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('lean-project-path')).toHaveTextContent(directory);
    expect(screen.getByTestId('lean-project-path')).toHaveClass('[overflow-wrap:anywhere]');
    expect(screen.getByRole('button', { name: 'Set up Lean' }).parentElement).toHaveClass('shrink-0', 'bg-transparent');
    expect(screen.getByText('About setup').closest('details')).not.toHaveAttribute('open');
  });
  it('opens setup from the matching editor action even after opting out, without building', async () => {
    status.dismissed = true;
    render(<LeanSetupPrompt owner="local" repo="math" blueprintId="workspace" showLauncher />);
    await screen.findByRole('button', { name: 'Set up Lean' });
    fireEvent(window, new CustomEvent(OPEN_LEAN_SETUP_EVENT, { detail: { owner: 'local', repo: 'other', blueprintId: 'workspace' } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent(window, new CustomEvent(OPEN_LEAN_SETUP_EVENT, { detail: { owner: 'local', repo: 'math', blueprintId: 'workspace' } }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Disk space');
    expect(mocks.request.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });

});
