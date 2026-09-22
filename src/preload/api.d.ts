import type { DesktopApi } from '@shared/desktop';

declare global {
  interface Window {
    fuse: DesktopApi;
  }
}

export {};
