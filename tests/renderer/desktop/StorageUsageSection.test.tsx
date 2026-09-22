import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageUsage, StorageUsageEntry } from '@shared/desktop';
import { formatStorageSize, StorageUsageSection } from '@/desktop/StorageUsageSection';
import { resetStorageCache } from '@/desktop/storage-cache';

const storage = vi.hoisted(() => ({ usage: vi.fn() }));
vi.mock('@/desktop/bridge', () => ({ desktopApi: () => ({ storage }) }));
const row = (patch: Partial<StorageUsageEntry>): StorageUsageEntry => ({
  id: 'fuse', label: 'Fuse app data', kind: 'fuse', path: '/app/Fuse', bytes: 1000,
  status: 'complete', skippedLinks: 0, skippedFiles: 0, lakeBytes: 0, oleanBytes: 0,
  lakeFolders: [], oleanFolders: [], ...patch,
});
const sample = (): StorageUsage => ({
  fuseBytes: 1000, sharedBytes: 2e9, measuredAt: new Date().toISOString(),
  entries: [row({}), row({
    id: 'repo-1', label: 'Kakeya', kind: 'repository', path: '/repo/Kakeya', bytes: 2e9, lakeBytes: 1e9, oleanBytes: 5e8,
    lakeFolders: [{ path: '/repo/Kakeya/.lake', bytes: 1e9 }],
    oleanFolders: [{ path: '/repo/Kakeya/.lake/build/lib/lean', bytes: 5e8 }],
  })],
});
beforeEach(() => { vi.clearAllMocks(); resetStorageCache(); storage.usage.mockResolvedValue(sample()); });

describe('storage overview', () => {
  it('shows ownership totals and expandable Lean build locations without double-adding them', async () => {
    render(<StorageUsageSection />);
    expect(screen.getByRole('status')).toHaveTextContent('Calculating');
    await screen.findByText('Kakeya');
    expect(screen.getByRole('heading', { name: 'Shared Lean data' })).toBeInTheDocument();
    expect(screen.getByText('1 KB', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('2 GB', { selector: 'dd' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Kakeya'));
    expect(screen.getByText('/repo/Kakeya/.lake/build/lib/lean')).toBeVisible();
    expect(screen.getByText(/included in the build\/dependency total/)).toBeVisible();
    expect(screen.getByText(/Excludes source files/)).toBeInTheDocument();
  });
  it('reports missing, aliased and partial locations honestly', async () => {
    const usage = sample();
    usage.entries[1].status = 'partial';
    usage.entries[1].skippedLinks = 2;
    usage.entries.push(row({ id: 'gone', label: 'Missing repo', kind: 'repository', status: 'missing' }));
    usage.entries.push(row({ id: 'alias', label: 'Alias', kind: 'repository', countedIn: 'Kakeya' }));
    storage.usage.mockResolvedValue(usage);
    render(<StorageUsageSection />);
    await screen.findByText('Kakeya');
    expect(screen.getByText('No build data')).toBeInTheDocument();
    expect(screen.getByText('Counted in Kakeya')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Kakeya'));
    expect(screen.getByText(/Incomplete estimate/)).toBeVisible();
    expect(screen.getByText(/2 symbolic links excluded/)).toBeVisible();
  });
  it('recovers from errors on focus and unregisters when closed', async () => {
    storage.usage.mockRejectedValueOnce(new Error('unavailable'));
    const view = render(<StorageUsageSection />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not measure'));
    fireEvent.focus(window);
    await screen.findByText('Kakeya');
    view.unmount();
    fireEvent.focus(window);
    expect(storage.usage).toHaveBeenCalledTimes(2);
  });
  it('does not launch parallel scans while a request is pending', async () => {
    let finish!: (result: StorageUsage) => void;
    storage.usage.mockReturnValue(new Promise<StorageUsage>(resolve => { finish = resolve; }));
    render(<StorageUsageSection />);
    fireEvent.focus(window);
    expect(storage.usage).toHaveBeenCalledTimes(1);
    await act(async () => { finish(sample()); });
  });
  it('formats readable decimal sizes', () => {
    expect(formatStorageSize(0)).toBe('0 B');
    expect(formatStorageSize(1234)).toBe('1.2 KB');
    expect(formatStorageSize(2.5e9)).toBe('2.5 GB');
  });
  it('shows the previous measurement immediately on return without another scan', async () => {
    const first = render(<StorageUsageSection />);
    await screen.findByText('Kakeya');
    first.unmount();
    render(<StorageUsageSection />);
    expect(screen.getByText('Kakeya')).toBeInTheDocument();
    expect(screen.queryByText('Calculating folder sizes…')).not.toBeInTheDocument();
    await act(async () => {});
    expect(storage.usage).toHaveBeenCalledOnce();
  });
});
