import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const router = vi.hoisted(() => ({ state: { location: { pathname: '/', search: '', hash: '' } }, subscribe: vi.fn(() => () => {}), navigate: vi.fn() }));
const appError = vi.hoisted(() => ({ error: null as string | null }));
const desktopIntegration = vi.hoisted(() => vi.fn(() => <div>desktop glue</div>));
vi.mock('@/router', () => ({ default: router }));
vi.mock('react-router-dom', () => ({ RouterProvider: () => <div>route content</div> }));
vi.mock('@/state/auth', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/state/theme', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ui/tooltip', () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/state/app-error', () => ({ AppErrorProvider: ({ children }: { children: ReactNode }) => children, AppErrorBoundary: ({ children }: { children: ReactNode }) => children, useAppError: () => appError }));
vi.mock('@/components/layout/AppErrorFallback', () => ({ default: ({ message }: { message: string }) => <div>fallback: {message}</div> }));
vi.mock('@/components/layout/SmallScreenWarning', () => ({ default: () => <div>screen warning</div> }));
vi.mock('@/desktop/DesktopIntegration', () => ({ default: desktopIntegration }));
import App from '@/App';

function resizeWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

describe('App shell', () => {
  beforeEach(() => { appError.error = null; desktopIntegration.mockClear(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 }); });
  it('overlays the small-window warning and mounts the desktop glue with the router', () => {
    render(<App />);
    expect(screen.getByText('route content')).toBeInTheDocument();
    expect(screen.getByText('screen warning')).toBeInTheDocument();
    expect(screen.getByText('desktop glue')).toBeInTheDocument();
    expect(desktopIntegration).toHaveBeenCalledWith(expect.objectContaining({ router }), undefined);
  });
  // The warning is an overlay, so shrinking and re-growing the window must
  // toggle it without ever unmounting the route below it (an in-flight agent
  // conversation has to survive the resize).
  it('toggles with the viewport and leaves the route mounted', () => {
    render(<App />);
    expect(screen.getByText('screen warning')).toBeInTheDocument();

    resizeWindow(1440, 900);
    expect(screen.queryByText('screen warning')).not.toBeInTheDocument();
    expect(screen.getByText('route content')).toBeInTheDocument();

    resizeWindow(800, 700);
    expect(screen.getByText('screen warning')).toBeInTheDocument();
    expect(screen.getByText('route content')).toBeInTheDocument();
  });
  it('replaces the router with the error fallback but keeps the desktop glue', () => {
    appError.error = 'boom';
    render(<App />);
    expect(screen.getByText('fallback: boom')).toBeInTheDocument();
    expect(screen.queryByText('route content')).not.toBeInTheDocument();
    expect(screen.getByText('desktop glue')).toBeInTheDocument();
  });
});
