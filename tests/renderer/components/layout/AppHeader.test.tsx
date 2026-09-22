import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: null as null | { is_admin: boolean; github_username: string } })); const navigation = vi.hoisted(() => ({ state: 'idle' }));
vi.mock('@/state/auth', () => ({ useAuth: () => auth }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode } & Record<string, unknown>) => <a href={to} {...props}>{children}</a>, useNavigation: () => navigation }));
vi.mock('@/components/layout/ThemeToggle', () => ({ default: () => <button>theme toggle</button> }));
vi.mock('@/components/ui/tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children, TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>, TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) => isValidElement(render) ? cloneElement(render, {}, children) : children }));
import AppHeader from '@/components/layout/AppHeader';

describe('AppHeader', () => {
  it('shows the desktop navigation for the local user', () => {
    auth.user = { is_admin: true, github_username: 'ada' };
    render(<AppHeader breadcrumbs={<span>crumb</span>} actions={<button>action</button>} />);
    expect(screen.getByRole('link', { name: /Fuse/ })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Active sessions' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/guide');
    expect(screen.getByText('theme toggle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chats' })).toHaveAttribute('href', '/chats');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('button', { name: 'Open user menu' })).not.toBeInTheDocument();
    expect(screen.getByText('crumb')).toBeInTheDocument();
    expect(screen.getByText('action')).toBeInTheDocument();
    // Hosted-only destinations are gone even for a user flagged as admin.
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument();
  });
  it('hides private navigation without a user and shows progress for navigation or owned loading', () => {
    auth.user = null; navigation.state = 'loading'; const { container } = render(<AppHeader />);
    expect(screen.queryByRole('link', { name: 'Active sessions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(container.querySelector('.navigation-progress-indicator')).toBeInTheDocument();
    navigation.state = 'idle';
    const owned = render(<AppHeader loading />);
    expect(owned.container.querySelector('.navigation-progress-indicator')).toBeInTheDocument();
  });
});
