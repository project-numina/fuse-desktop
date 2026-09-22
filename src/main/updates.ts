import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Downloads stable releases in the background; installation waits for normal quit. */
export function startUpdates(): { check: () => Promise<void> } {
  const supported = app.isPackaged && (process.platform !== 'linux' || Boolean(process.env.APPIMAGE));
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  let busy = false;
  let downloaded = false;
  let stopped = false;
  const show = async (message: string): Promise<void> => {
    await dialog.showMessageBox({ type: 'info', title: 'Fuse updates', message });
  };
  // Error events may also accompany rejected promises. Background failures stay quiet.
  autoUpdater.on('error', () => { console.warn('[updates] Update check or download failed; will retry later.'); });
  autoUpdater.on('update-downloaded', () => { downloaded = true; });

  async function check(manual = false): Promise<void> {
    if (stopped) return;
    if (!supported) {
      if (manual) await show('Automatic updates are available in installed macOS, Windows, and Linux AppImage builds.');
      return;
    }
    if (busy || downloaded) {
      if (manual) await show(downloaded ? 'Update ready. Quit and reopen Fuse when you’re ready to install it.' : 'An update check or download is already in progress.');
      return;
    }
    busy = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.downloadPromise) {
        await result.downloadPromise;
        if (manual && !stopped) await show('Update ready. Quit and reopen Fuse when you’re ready to install it.');
      } else if (manual && !stopped) await show('Fuse is up to date.');
    } catch {
      if (manual && !stopped) await show('Could not check for updates. Please try again later.');
    } finally {
      busy = false;
    }
  }

  const initial = setTimeout(() => { void check(); }, 30_000);
  const interval = setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
  initial.unref();
  interval.unref();
  app.once('before-quit', () => {
    stopped = true;
    clearTimeout(initial);
    clearInterval(interval);
  });
  return { check: () => check(true) };
}
