import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppErrorFallback from '@/components/layout/AppErrorFallback';

describe('AppErrorFallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('presents the error and exposes clear recovery actions', () => {
    render(<AppErrorFallback message="The workspace could not be loaded." />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Numina' })).toHaveAttribute(
      'src',
      '/numina_logo.svg',
    );
    expect(screen.getByRole('heading', { name: 'We hit a problem.' })).toBeInTheDocument();
    expect(screen.getByText('The workspace could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('type', 'button');
  });

  it('reloads the current page or returns to the dashboard', () => {
    const reload = vi.fn();
    const assign = vi.fn();
    const realWindow = window;
    const windowWithMockedLocation = new Proxy(realWindow, {
      get(target, property) {
        if (property === 'location') return { reload, assign };
        return Reflect.get(target, property, target);
      },
    });
    vi.stubGlobal('window', windowWithMockedLocation);

    render(<AppErrorFallback message="Unexpected failure" />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));

    expect(reload).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/');
  });
});
