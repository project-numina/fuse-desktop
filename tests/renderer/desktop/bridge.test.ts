import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ registerRepository: vi.fn() }));
const dashboard = vi.hoisted(() => ({ reloadDashboardRepositories: vi.fn() }));
vi.mock('@/lib/api/repositories', () => api);
vi.mock('@/state/dashboard', () => dashboard);

import {
  desktopApi,
  isDesktop,
  openFolderAsRepository,
  pickAndRegisterFolder,
  pickFolder,
  repositoryRoute,
  showInFolder,
} from '@/desktop/bridge';

const fuse = {
  dialog: { pickFolder: vi.fn(), pathForFile: vi.fn() },
  shell: { showInFolder: vi.fn(), openPath: vi.fn(), openExternal: vi.fn() },
};

describe('desktop bridge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.registerRepository.mockResolvedValue({ id: 7, owner: 'home', name: 'proj', visibility: 'private' });
    dashboard.reloadDashboardRepositories.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete (window as { fuse?: unknown }).fuse;
  });

  it('reports the bridge as absent in a plain browser and degrades gracefully', async () => {
    expect(desktopApi()).toBeNull();
    expect(isDesktop()).toBe(false);
    await expect(pickFolder()).resolves.toBeNull();
    await expect(pickAndRegisterFolder()).resolves.toBeNull();
    expect(() => showInFolder('/x')).not.toThrow();
    expect(api.registerRepository).not.toHaveBeenCalled();
  });

  it('picks, registers, and refreshes the dashboard', async () => {
    (window as { fuse?: unknown }).fuse = fuse;
    fuse.dialog.pickFolder.mockResolvedValue('C:\\Users\\ada\\proj');
    const repository = await pickAndRegisterFolder();
    expect(api.registerRepository).toHaveBeenCalledWith('C:\\Users\\ada\\proj');
    expect(dashboard.reloadDashboardRepositories).toHaveBeenCalledOnce();
    expect(repository?.owner).toBe('home');
    expect(repositoryRoute(repository!)).toBe('/repo/home/proj');
  });

  it('treats a cancelled dialog as nothing picked', async () => {
    (window as { fuse?: unknown }).fuse = fuse;
    fuse.dialog.pickFolder.mockResolvedValue(null);
    await expect(pickAndRegisterFolder()).resolves.toBeNull();
    expect(api.registerRepository).not.toHaveBeenCalled();
  });

  it('keeps a successful registration even if the dashboard refresh fails', async () => {
    (window as { fuse?: unknown }).fuse = fuse;
    dashboard.reloadDashboardRepositories.mockRejectedValue(new Error('offline'));
    await expect(openFolderAsRepository('/tmp/proj')).resolves.toMatchObject({ name: 'proj' });
    showInFolder('/tmp/proj');
    expect(fuse.shell.showInFolder).toHaveBeenCalledWith('/tmp/proj');
    expect(repositoryRoute({ owner: 'a b', name: 'c/d' })).toBe('/repo/a%20b/c%2Fd');
  });
});
