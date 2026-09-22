import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

const themeState = vi.hoisted(() => ({
  theme: 'system' as 'system' | 'light' | 'dark',
  setTheme: vi.fn(),
}));

vi.mock('@/state/theme', () => ({
  useTheme: () => themeState,
}));

import ThemeToggle from '@/components/layout/ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    themeState.theme = 'system';
    themeState.setTheme.mockReset();
  });

  it('labels the current appearance control and its selected option', async () => {
    render(
      <TooltipProvider delay={0}>
        <ThemeToggle />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Appearance' });
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(trigger);

    const system = await screen.findByRole('menuitemradio', { name: 'System' });
    expect(screen.getByText('Appearance', { selector: '[data-slot="dropdown-menu-label"]' }))
      .toBeInTheDocument();
    expect(system).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('selects a theme and closes the menu', async () => {
    render(
      <TooltipProvider delay={0}>
        <ThemeToggle />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

    expect(themeState.setTheme).toHaveBeenCalledWith('dark');
    await waitFor(() => {
      expect(screen.queryByRole('menuitemradio', { name: 'Dark' })).not.toBeInTheDocument();
    });
  });
});
