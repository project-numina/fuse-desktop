import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BrowserWindow, Rectangle, Screen } from 'electron';

export interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  bounds: { x: 0, y: 0, width: 1380, height: 900 },
  maximized: false,
};

/** Keep remembered bounds only when they still land on a connected display. */
export function fitToDisplays(state: WindowState, displays: readonly Rectangle[]): WindowState {
  const { bounds } = state;
  const visible = displays.some(
    (display) =>
      bounds.x + bounds.width > display.x + 40
      && bounds.x < display.x + display.width - 40
      && bounds.y >= display.y - 10
      && bounds.y < display.y + display.height - 40,
  );
  if (visible) return state;
  return { ...state, bounds: { ...DEFAULT_WINDOW_STATE.bounds, x: undefined as unknown as number, y: undefined as unknown as number } };
}

export class WindowStateStore {
  constructor(private readonly file: string) {}

  load(screen: Screen): WindowState {
    let stored = DEFAULT_WINDOW_STATE;
    if (existsSync(this.file)) {
      try {
        stored = { ...DEFAULT_WINDOW_STATE, ...(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<WindowState>) };
      } catch {
        stored = DEFAULT_WINDOW_STATE;
      }
    } else {
      // First launch: centre on the primary display by omitting x/y.
      return { ...stored, bounds: { ...stored.bounds, x: undefined as unknown as number, y: undefined as unknown as number } };
    }
    return fitToDisplays(stored, screen.getAllDisplays().map((display) => display.workArea));
  }

  /** Persist bounds on resize/move/close, throttled to the trailing edge. */
  track(window: BrowserWindow): void {
    let timer: NodeJS.Timeout | null = null;
    const save = (): void => {
      if (window.isDestroyed() || window.isMinimized()) return;
      const state: WindowState = {
        bounds: window.isMaximized() ? this.current(window).bounds : window.getNormalBounds(),
        maximized: window.isMaximized(),
      };
      try {
        writeFileSync(this.file, JSON.stringify(state));
      } catch {
        /* best effort */
      }
    };
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 300);
    };
    window.on('resize', schedule);
    window.on('move', schedule);
    window.on('maximize', schedule);
    window.on('unmaximize', schedule);
    window.on('close', () => {
      if (timer) clearTimeout(timer);
      save();
    });
  }

  private current(window: BrowserWindow): WindowState {
    if (existsSync(this.file)) {
      try {
        return { ...DEFAULT_WINDOW_STATE, ...(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<WindowState>) };
      } catch {
        /* fall through */
      }
    }
    return { ...DEFAULT_WINDOW_STATE, bounds: window.getNormalBounds() };
  }
}
