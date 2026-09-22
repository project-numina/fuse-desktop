import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ProviderInfo } from '@shared/desktop';
import { DEFAULT_NOTIFICATIONS } from '@shared/desktop';

const auth = vi.hoisted(() => ({ user: { github_username: 'ada', name: 'Ada Lovelace' as string | null, github_avatar_url: null, is_admin: false, can_use_oauth_token: true, user_group: 'numina' as const }, checkSession: vi.fn() }));
const desktop = vi.hoisted(() => ({
  state: {
    available: true,
    settings: null as AppSettings | null,
    providers: [] as ProviderInfo[],
    loading: false,
    saving: false,
    detecting: false,
    error: null as string | null,
  },
  update: vi.fn(),
  detect: vi.fn(),
}));
vi.mock('@/state/auth', () => ({ useAuth: () => auth }));
vi.mock('@/desktop/use-desktop-settings', () => ({ useDesktopSettings: () => desktop }));
vi.mock('@/components/layout/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => null }));
import Account from '@/pages/Account';

const settings = (): AppSettings => ({
  textSize: 'default',
  notifications: DEFAULT_NOTIFICATIONS,
  theme: 'system',
  claudePath: '',
  codexPath: '/opt/codex/bin/codex',
  agentDefaults: { provider: 'claude', model: '', effort: null, claude_permission_mode: 'acceptEdits', codex_sandbox: 'workspace-write' },
  displayName: 'Ada',
  aiCommitMessages: false,
  lastRoute: null,
});

describe('Settings page', () => {
  it('uses one page scrollbar with the heading and navigation pinned together', () => {
    render(<Account />);
    const navigation = screen.getByRole('navigation', { name: 'Settings sections' });
    const content = screen.getByRole('region', { name: 'Settings content' });
    expect(content).not.toHaveClass('overflow-y-auto');
    expect(content).not.toContainElement(navigation);
    expect(navigation.closest('aside')).toHaveClass('sticky');
    expect(navigation.closest('aside')).toHaveTextContent('Settings');
    const page = content.closest('main')!.parentElement!;
    expect(page).toHaveClass('overflow-y-auto');
    page.scrollTop = 300;
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(page.scrollTop).toBe(0);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    auth.user.name = 'Ada Lovelace';
    auth.checkSession.mockResolvedValue(undefined);
    desktop.state.available = true;
    desktop.state.settings = settings();
    desktop.state.providers = [
      { id: 'claude', label: 'Claude Code', command: 'claude', available: true, version: '2.0.1 (Claude Code)', path: '/usr/local/bin/claude', error: null },
      { id: 'codex', label: 'Codex', command: 'codex', available: false, version: null, path: null, error: 'Could not find `codex` on your PATH.' },
    ];
    desktop.state.error = null;
    desktop.update.mockImplementation(async (patch: Partial<AppSettings>) => {
      desktop.state.settings = { ...settings(), ...patch, agentDefaults: { ...settings().agentDefaults, ...(patch.agentDefaults ?? {}) } };
      return true;
    });
    desktop.detect.mockResolvedValue(undefined);
  });

  it('opens Agents directly with other preferences grouped separately', () => {
    render(<Account />);
    expect(screen.queryByText('Local user on this computer.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Theme:/ })).not.toBeInTheDocument();
    // Hosted-only sections are gone.
    for (const gone of ['Sign out', 'Delete account', 'Add account']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Data' })).toBeInTheDocument();
    expect(screen.queryByText('Data & storage')).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="https://github.com"]')).toBeNull();
  });

  it('shows agent controls without a category selection first', () => {
    render(<Account />);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Model: CLI default/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Agent defaults' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Theme: System/ })).not.toBeInTheDocument();
  });

  it('has no Git identity or commit automation settings', () => {
    render(<Account />);
    expect(screen.queryByRole('button', { name: 'Git & identity' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows CLI detection status and re-detects after a path change', async () => {
    render(<Account />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(screen.getByText('2.0.1 (Claude Code)')).toBeInTheDocument();
    expect(screen.getByText('Could not find `codex` on your PATH.')).toBeInTheDocument();
    const codexPath = screen.getByLabelText('Codex executable path');
    expect(codexPath).not.toBeVisible();
    fireEvent.click(screen.getByText('Advanced paths'));
    expect(codexPath).toHaveValue('/opt/codex/bin/codex');
    fireEvent.change(codexPath, { target: { value: 'C:\\tools\\codex.exe' } });
    fireEvent.keyDown(codexPath, { key: 'Enter' });
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ codexPath: 'C:\\tools\\codex.exe' }));
    await waitFor(() => expect(desktop.detect).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(desktop.detect).toHaveBeenCalledTimes(2);
  });

  it('saves default agent configuration as it changes', async () => {
    render(<Account />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    fireEvent.click(screen.getByRole('button', { name: /Default provider: Claude Code/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Codex' }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ provider: 'codex' }) }));

    fireEvent.click(screen.getByRole('button', { name: /Model: CLI default/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'opus' }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ model: 'opus' }) }));

    fireEvent.click(screen.getByRole('button', { name: /Default effort: CLI default/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'high' }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ effort: 'high' }) }));

    fireEvent.click(screen.getByRole('button', { name: /Claude Code permissions: Ask for commands/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Plan only/ }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ claude_permission_mode: 'plan' }) }));

    fireEvent.click(screen.getByRole('button', { name: /Codex sandbox: Workspace write/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Read only/ }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ codex_sandbox: 'read-only' }) }));
  });

  it.each([
    ['Claude Code permissions', 'Bypass permissions (dangerous)', 'Enable bypass permissions', { claude_permission_mode: 'bypassPermissions' }],
    ['Codex sandbox', 'Full access (dangerous)', 'Enable full access', { codex_sandbox: 'danger-full-access' }],
  ])('confirms dangerous defaults for %s before persisting them', async (label, option, confirm, patch) => {
    render(<Account />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: option as string }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('new workspaces only');
    expect(desktop.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: confirm as string }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledExactlyOnceWith({
      agentDefaults: expect.objectContaining(patch),
    }));
  });

  it('preserves custom model names and can restore the CLI default', async () => {
    desktop.state.settings!.agentDefaults.model = 'my-custom-model';
    render(<Account />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    const input = screen.getByLabelText('Custom model');
    expect(input).toHaveValue('my-custom-model');
    fireEvent.change(input, { target: { value: 'custom-next' } });
    fireEvent.blur(input);
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ model: 'custom-next' }) }));
    fireEvent.click(screen.getByRole('button', { name: /Model: Custom model/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'CLI default' }));
    await waitFor(() => expect(desktop.update).toHaveBeenCalledWith({ agentDefaults: expect.objectContaining({ model: '' }) }));
  });

  it('hides the desktop sections outside Electron and surfaces bridge errors', () => {
    desktop.state.available = false;
    desktop.state.settings = null;
    desktop.state.error = 'Could not load desktop settings.';
    render(<Account />);
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Command-line tools')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Could not load desktop settings.')).toBeInTheDocument();
  });
});
