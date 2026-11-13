import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerDirectoryPicker } from '@/desktop/server-directory-picker';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/api/core', () => api);
const home = { path: '/srv/home', parent: '/srv', directories: [{ name: 'projects', path: '/srv/home/projects' }], truncated: false };
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('server directory picker', () => {
  it('loads home, browses children and parent, filters on the server, and validates selection', async () => {
    api.request.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/validate')) return { path: JSON.parse(options!.body as string).path };
      if (url.includes('path=%2Fsrv%2Fhome%2Fprojects')) return { ...home, path: '/srv/home/projects', parent: '/srv/home', directories: [] };
      return home;
    });
    const select = vi.fn(); render(<ServerDirectoryPicker onSelect={select} />);
    expect(await screen.findByRole('button', { name: 'projects' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'projects' }));
    await waitFor(() => expect(screen.getByLabelText('Absolute folder path')).toHaveValue('/srv/home/projects'));
    fireEvent.click(screen.getByRole('button', { name: 'Up' }));
    await screen.findByRole('button', { name: 'projects' });
    fireEvent.change(screen.getByPlaceholderText('Search folder names'), { target: { value: 'proj' } });
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/local/directories?path=%2Fsrv%2Fhome&filter=proj', expect.anything()));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select folder' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Select folder' }));
    await waitFor(() => expect(select).toHaveBeenCalledWith('/srv/home'));
  });

  it('allows typed server paths and reports validation errors without closing', async () => {
    api.request.mockResolvedValue(home);
    const select = vi.fn(); render(<ServerDirectoryPicker onSelect={select} />);
    await screen.findByRole('button', { name: 'projects' });
    fireEvent.change(screen.getByLabelText('Absolute folder path'), { target: { value: '/private/project' } });
    api.request.mockRejectedValueOnce(new Error('Directory is not accessible.'));
    fireEvent.click(screen.getByRole('button', { name: 'Select folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Directory is not accessible.');
    expect(select).not.toHaveBeenCalled();
    expect(api.request).toHaveBeenLastCalledWith('/local/directories/validate', { method: 'POST', body: JSON.stringify({ path: '/private/project' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(select).toHaveBeenCalledWith(null);
  });

  it('shows loading, listing errors, and retries with Home', async () => {
    api.request.mockRejectedValueOnce(new Error('Could not read folder.')).mockResolvedValue(home);
    render(<ServerDirectoryPicker onSelect={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading folders');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read folder.');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(await screen.findByRole('button', { name: 'projects' })).toBeInTheDocument();
  });
});
