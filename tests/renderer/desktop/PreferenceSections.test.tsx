import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/desktop';
import { AppearanceSettings, NotificationSettings, StorageSettings } from '@/desktop/PreferenceSections';
import type { DesktopSectionProps } from '@/desktop/DesktopSettingsSections';

const theme = vi.hoisted(() => ({ theme: 'system', setTheme: vi.fn() }));
vi.mock('@/state/theme', () => ({ useTheme: () => theme }));
const storage = vi.hoisted(() => ({ info: vi.fn(), usage: vi.fn(), open: vi.fn(), export: vi.fn() }));
vi.mock('@/desktop/bridge', () => ({ desktopApi: () => ({ storage }) }));
function props(): DesktopSectionProps {
  return {
    state: { available: true, settings: DEFAULT_SETTINGS, providers: [], loading: false, saving: false, detecting: false, error: null },
    update: vi.fn().mockResolvedValue(true), detect: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  storage.info.mockResolvedValue({ path: '/local/Fuse' });
  storage.usage.mockResolvedValue({ entries: [], fuseBytes: 0, sharedBytes: 0, measuredAt: new Date().toISOString() });
  storage.open.mockResolvedValue(undefined);
  storage.export.mockResolvedValue({ path: '/backup/fuse.json', fileCount: 2 });
});

describe('preference controls', () => {
  it('uses the same theme state as the navbar', () => {
    render(<AppearanceSettings {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Theme: System' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(theme.setTheme).toHaveBeenCalledWith('dark');
  });
  it('saves notification toggles without a save button or redundant helper text', async () => {
    const p = props();
    render(<NotificationSettings {...p} />);
    expect(screen.getByRole('switch', { name: 'Agent finishes' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'Agent finishes' }));
    await waitFor(() => expect(p.update).toHaveBeenCalledWith({ notifications: { ...DEFAULT_SETTINGS.notifications, completed: true } }));
    expect(screen.queryByText(/Saves automatically/)).not.toBeInTheDocument();
  });
  it('offers plain-language global sizes without editor toggles or percentages', () => {
    const p = props();
    render(<AppearanceSettings {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Text size: Default' }));
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Small', 'Default', 'Large', 'Extra large']);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
    expect(p.update).toHaveBeenCalledWith({ textSize: 'large' });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
  it('disables controls while a save is in flight', () => {
    const p = props(); p.state.saving = true;
    render(<><AppearanceSettings {...p} /><NotificationSettings {...p} /></>);
    for (const control of screen.getAllByRole('switch')) expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: /Text size:/ })).toBeDisabled();
  });
});

describe('local storage controls', () => {
  it('distinguishes Fuse data, project files, agent history, and provider processing', async () => {
    render(<StorageSettings />);
    await screen.findByText('/local/Fuse');
    expect(screen.getByText(/imported documents/)).not.toBeVisible();
    fireEvent.click(screen.getByText('About your data'));
    for (const name of ['In Fuse’s local folder', 'In your project folders', 'Managed by your agents', 'Sent to model providers']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/imported documents/)).toBeInTheDocument();
    expect(screen.getByText(/removing a workspace from Fuse does not delete/)).toBeInTheDocument();
    expect(screen.getByText('~/.claude')).toBeInTheDocument();
    expect(screen.getByText('~/.codex')).toBeInTheDocument();
    expect(screen.getByText(/Removing a chat from Fuse does not delete/)).toBeInTheDocument();
    expect(screen.getByText(/not stored only on this computer/)).toBeInTheDocument();
  });
  it('shows the actual location and only exports after the user asks', async () => {
    render(<StorageSettings />);
    await screen.findByText('/local/Fuse');
    fireEvent.click(screen.getByText('Advanced'));
    expect(storage.export).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => expect(storage.open).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export local data…' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export local data…' }));
    expect(await screen.findByRole('status')).toHaveTextContent('/backup/fuse.json');
    expect(screen.getByText(/private chat content/)).toBeInTheDocument();
  });
  it('treats cancellation as a no-op, not a success or error', async () => {
    storage.export.mockResolvedValue(null);
    render(<StorageSettings />);
    await screen.findByText('/local/Fuse');
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Export local data…' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export local data…' })).toBeEnabled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('reports an export failure and allows retry', async () => {
    storage.export.mockRejectedValueOnce(new Error('write failed'));
    render(<StorageSettings />);
    await screen.findByText('/local/Fuse');
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Export local data…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not export');
    fireEvent.click(screen.getByRole('button', { name: 'Export local data…' }));
    expect(await screen.findByRole('status')).toHaveTextContent('/backup/fuse.json');
  });
});
