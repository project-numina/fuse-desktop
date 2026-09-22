import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ packaged: true, show: vi.fn(), check: vi.fn() }));
const updater = Object.assign(new EventEmitter(), { checkForUpdates: mocks.check });
const app = Object.defineProperty(new EventEmitter(), 'isPackaged', { get: () => mocks.packaged });
vi.mock('electron', () => ({ app, dialog: { showMessageBox: mocks.show } }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }));
const { startUpdates } = await import('@main/updates');

describe('release updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updater.removeAllListeners();
    app.removeAllListeners();
    mocks.packaged = true;
    vi.stubEnv('APPIMAGE', '/tmp/Fuse.AppImage');
    mocks.check.mockResolvedValue(null);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('checks periodically, downloads stable releases, and never forces a restart', async () => {
    startUpdates();
    expect(updater).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: false, allowDowngrade: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(mocks.show).not.toHaveBeenCalled();
    app.emit('before-quit');
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it('does not contact the release server in development', async () => {
    mocks.packaged = false;
    const updates = startUpdates();
    await updates.check();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledOnce();
  });

  it('reports downloaded updates without downloading again', async () => {
    const updates = startUpdates();
    mocks.check.mockResolvedValue({ downloadPromise: Promise.resolve([]) });
    await updates.check();
    updater.emit('update-downloaded');
    await updates.check();
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.show).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('Quit and reopen') }));
  });

  it('handles offline checks and allows retry', async () => {
    const updates = startUpdates();
    mocks.check.mockRejectedValueOnce(new Error('offline'));
    await updates.check();
    expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Could not check') }));
    await updates.check();
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous checks', async () => {
    let resolve!: (value: null) => void;
    mocks.check.mockReturnValue(new Promise((done) => { resolve = done; }));
    const updates = startUpdates();
    const first = updates.check();
    await updates.check();
    expect(mocks.check).toHaveBeenCalledOnce();
    resolve(null);
    await first;
  });
});
