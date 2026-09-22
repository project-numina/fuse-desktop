import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, Rectangle, Screen } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WINDOW_STATE, WindowStateStore, fitToDisplays, type WindowState } from '@main/window-state';

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('fitToDisplays', () => {
  it('keeps bounds that overlap a display', () => {
    const state = { bounds: { x: 100, y: 50, width: 1200, height: 800 }, maximized: false };
    expect(fitToDisplays(state, [display])).toBe(state);
  });

  it('recentres bounds left on a disconnected monitor', () => {
    const state = { bounds: { x: 3000, y: 50, width: 1200, height: 800 }, maximized: true };
    const fitted = fitToDisplays(state, [display]);
    expect(fitted.bounds.width).toBe(DEFAULT_WINDOW_STATE.bounds.width);
    expect(fitted.bounds.x).toBeUndefined();
    expect(fitted.maximized).toBe(true);
  });

  it('accepts visibility on any connected display', () => {
    const second = { x: 1920, y: -200, width: 1600, height: 1200 };
    const state = { bounds: { x: 2000, y: -100, width: 900, height: 700 }, maximized: false };
    expect(fitToDisplays(state, [display, second])).toBe(state);
  });

  it.each([
    ['only forty pixels remain on the left', { x: -1160, y: 20, width: 1200, height: 800 }],
    ['the left edge is inside the right margin', { x: 1880, y: 20, width: 1200, height: 800 }],
    ['the title bar is above the display', { x: 20, y: -11, width: 1200, height: 800 }],
    ['the title bar is below the display', { x: 20, y: 1040, width: 1200, height: 800 }],
  ])('recentres when %s', (_label, bounds) => {
    const result = fitToDisplays({ bounds, maximized: false }, [display]);
    expect(result.bounds).toEqual({ ...DEFAULT_WINDOW_STATE.bounds, x: undefined, y: undefined });
  });
});

function fakeScreen(displays: Rectangle[] = [display]) {
  return {
    getAllDisplays: vi.fn(() => displays.map((workArea, id) => ({ id, workArea }))),
  } as unknown as Screen;
}

function fakeWindow(initialBounds: Rectangle = { x: 30, y: 40, width: 1000, height: 700 }) {
  const listeners = new Map<string, Array<() => void>>();
  let bounds = initialBounds;
  let destroyed = false;
  let minimized = false;
  let maximized = false;
  const window = {
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return window;
    }),
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => minimized),
    isMaximized: vi.fn(() => maximized),
    getNormalBounds: vi.fn(() => bounds),
  };
  return {
    value: window as unknown as BrowserWindow,
    listeners,
    emit(event: string): void {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    setBounds(next: Rectangle): void { bounds = next; },
    setDestroyed(next: boolean): void { destroyed = next; },
    setMinimized(next: boolean): void { minimized = next; },
    setMaximized(next: boolean): void { maximized = next; },
  };
}

describe('WindowStateStore.load', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function path(name = 'window-state.json'): string {
    const dir = mkdtempSync(join(tmpdir(), 'fuse-window-state-'));
    dirs.push(dir);
    return join(dir, name);
  }

  it('centres the default bounds on first launch without querying displays', () => {
    const screen = fakeScreen();
    expect(new WindowStateStore(path()).load(screen)).toEqual({
      bounds: { ...DEFAULT_WINDOW_STATE.bounds, x: undefined, y: undefined },
      maximized: false,
    });
    expect(screen.getAllDisplays).not.toHaveBeenCalled();
  });

  it('loads a valid state that remains visible', () => {
    const file = path();
    const state: WindowState = { bounds: { x: 120, y: 80, width: 1100, height: 720 }, maximized: true };
    writeFileSync(file, JSON.stringify(state));
    const screen = fakeScreen();

    expect(new WindowStateStore(file).load(screen)).toEqual(state);
    expect(screen.getAllDisplays).toHaveBeenCalledOnce();
  });

  it('fills omitted top-level fields from defaults', () => {
    const file = path();
    writeFileSync(file, JSON.stringify({ maximized: true }));

    expect(new WindowStateStore(file).load(fakeScreen())).toEqual({ ...DEFAULT_WINDOW_STATE, maximized: true });
  });

  it('uses safe defaults for invalid JSON and unreadable state files', () => {
    const invalid = path();
    writeFileSync(invalid, '{not json');
    expect(new WindowStateStore(invalid).load(fakeScreen())).toEqual(DEFAULT_WINDOW_STATE);

    const unreadable = path('state-directory');
    mkdirSync(unreadable);
    expect(new WindowStateStore(unreadable).load(fakeScreen())).toEqual(DEFAULT_WINDOW_STATE);
  });

  it('recentres a valid state whose display was disconnected', () => {
    const file = path();
    writeFileSync(file, JSON.stringify({ bounds: { x: 4000, y: 50, width: 1000, height: 700 }, maximized: true }));
    const result = new WindowStateStore(file).load(fakeScreen());

    expect(result).toEqual({
      bounds: { ...DEFAULT_WINDOW_STATE.bounds, x: undefined, y: undefined },
      maximized: true,
    });
  });
});

describe('WindowStateStore.track', () => {
  const dirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function path(name = 'window-state.json'): string {
    const dir = mkdtempSync(join(tmpdir(), 'fuse-window-track-'));
    dirs.push(dir);
    return join(dir, name);
  }

  function readState(file: string): WindowState {
    return JSON.parse(readFileSync(file, 'utf8')) as WindowState;
  }

  it('registers every window-state event and persists normal bounds on the trailing edge', () => {
    const file = path();
    const tracked = fakeWindow();
    new WindowStateStore(file).track(tracked.value);

    expect([...tracked.listeners.keys()]).toEqual(['resize', 'move', 'maximize', 'unmaximize', 'close']);
    for (const event of ['resize', 'move', 'maximize', 'unmaximize']) tracked.emit(event);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(299);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(readState(file)).toEqual({ bounds: { x: 30, y: 40, width: 1000, height: 700 }, maximized: false });
  });

  it('debounces repeated move and resize events', () => {
    const file = path();
    const tracked = fakeWindow();
    new WindowStateStore(file).track(tracked.value);

    tracked.emit('resize');
    vi.advanceTimersByTime(200);
    tracked.setBounds({ x: 300, y: 200, width: 900, height: 650 });
    tracked.emit('move');
    vi.advanceTimersByTime(299);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(readState(file).bounds).toEqual({ x: 300, y: 200, width: 900, height: 650 });
  });

  it('keeps the last normal bounds while recording a maximized window', () => {
    const file = path();
    const previous = { x: 55, y: 65, width: 1110, height: 710 };
    writeFileSync(file, JSON.stringify({ bounds: previous, maximized: false }));
    const tracked = fakeWindow({ x: 0, y: 0, width: 1920, height: 1080 });
    tracked.setMaximized(true);
    new WindowStateStore(file).track(tracked.value);

    tracked.emit('maximize');
    vi.advanceTimersByTime(300);
    expect(readState(file)).toEqual({ bounds: previous, maximized: true });
  });

  it('falls back to current normal bounds when maximized state cannot be read', () => {
    const file = path();
    writeFileSync(file, 'invalid');
    const normal = { x: 75, y: 85, width: 950, height: 625 };
    const tracked = fakeWindow(normal);
    tracked.setMaximized(true);
    new WindowStateStore(file).track(tracked.value);

    tracked.emit('maximize');
    vi.advanceTimersByTime(300);
    expect(readState(file)).toEqual({ bounds: normal, maximized: true });
  });

  it('uses current normal bounds when no earlier state file exists', () => {
    const file = path();
    const normal = { x: 10, y: 15, width: 800, height: 600 };
    const tracked = fakeWindow(normal);
    tracked.setMaximized(true);
    new WindowStateStore(file).track(tracked.value);

    tracked.emit('maximize');
    vi.advanceTimersByTime(300);
    expect(readState(file)).toEqual({ bounds: normal, maximized: true });
  });

  it.each([
    ['destroyed', (window: ReturnType<typeof fakeWindow>) => window.setDestroyed(true)],
    ['minimized', (window: ReturnType<typeof fakeWindow>) => window.setMinimized(true)],
  ])('does not persist a %s window', (_label, configure) => {
    const file = path();
    const tracked = fakeWindow();
    configure(tracked);
    new WindowStateStore(file).track(tracked.value);

    tracked.emit('resize');
    vi.advanceTimersByTime(300);
    tracked.emit('close');
    expect(existsSync(file)).toBe(false);
  });

  it('saves synchronously on close and cancels a pending trailing save', () => {
    const file = path();
    const tracked = fakeWindow({ x: 10, y: 20, width: 800, height: 600 });
    new WindowStateStore(file).track(tracked.value);

    tracked.emit('resize');
    tracked.setBounds({ x: 40, y: 50, width: 900, height: 650 });
    tracked.emit('close');
    expect(readState(file).bounds).toEqual({ x: 40, y: 50, width: 900, height: 650 });

    tracked.setBounds({ x: 500, y: 500, width: 500, height: 500 });
    vi.advanceTimersByTime(300);
    expect(readState(file).bounds).toEqual({ x: 40, y: 50, width: 900, height: 650 });
  });

  it('swallows write failures because persistence is best effort', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuse-window-track-missing-'));
    dirs.push(dir);
    const file = join(dir, 'missing', 'window-state.json');
    const tracked = fakeWindow();
    new WindowStateStore(file).track(tracked.value);

    expect(() => tracked.emit('close')).not.toThrow();
    expect(existsSync(file)).toBe(false);
  });
});
