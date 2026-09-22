import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteSessionHistory,
  fetchSessionHistory,
  fetchNativeHistoryStatus,
} from '@/lib/api';
import { SESSION_HISTORY_CHANGED_EVENT } from '@/lib/session-events';

import HistoryMode, { type SessionHistorySummary } from '@/features/blueprint/components/HistoryMode';
import type { SessionAttention } from '@shared/session-attention';

const attention = vi.hoisted(() => ({ entries: [] as SessionAttention[] }));
vi.mock('@/hooks/use-session-attention', () => ({ useSessionAttention: () => attention.entries, refreshSessionAttention: vi.fn() }));

vi.mock('@/lib/api', () => ({
  deleteSessionHistory: vi.fn(),
  fetchSessionHistory: vi.fn(),
  fetchNativeHistoryStatus: vi.fn(async () => ({ warnings: [] })),
}));

const deleteHistoryMock = vi.mocked(deleteSessionHistory);
const fetchHistoryMock = vi.mocked(fetchSessionHistory);

function session(overrides: Partial<SessionHistorySummary> = {}): SessionHistorySummary {
  return {
    id: 'conversation-1', title: 'Greeting', status: 'completed', tier: 'completed',
    blueprint_name: 'blueprint', created_at: '2026-04-12T00:00:00Z',
    completed_at: '2026-04-12T00:01:00Z', first_message: 'Hi', last_message: 'Hello',
    last_message_at: '2026-04-12T00:01:00Z', ...overrides,
  };
}

function setup(overrides: Partial<React.ComponentProps<typeof HistoryMode>> = {}) {
  const props = {
    owner: 'owner', repo: 'repo', blueprintId: 'blueprint',
    onSelectSession: vi.fn(), onNewChat: vi.fn(), ...overrides,
  };
  render(<HistoryMode {...props} />);
  return props;
}

beforeEach(() => {
  vi.mocked(fetchNativeHistoryStatus).mockReset().mockResolvedValue({ warnings: [] });
  attention.entries = [];
  fetchHistoryMock.mockReset().mockResolvedValue([session()] as never);
  deleteHistoryMock.mockReset().mockResolvedValue(undefined as never);
});

describe('HistoryMode', () => {
  it('shows existing rows before a slow native status request finishes', async () => {
    vi.mocked(fetchNativeHistoryStatus).mockImplementationOnce(() => new Promise(() => {}));
    setup();
    expect(await screen.findByText('Greeting')).toBeInTheDocument();
    expect(screen.queryByText('Loading history…')).not.toBeInTheDocument();
  });

  it('refreshes the visible index after background discovery without starting another scan', async () => {
    vi.mocked(fetchNativeHistoryStatus)
      .mockResolvedValueOnce({ warnings: [], refreshing: true })
      .mockResolvedValue({ warnings: [], refreshing: false });
    fetchHistoryMock.mockResolvedValueOnce([session()]).mockResolvedValue([session(), session({ id: 'new', title: 'New native chat' })]);
    setup();
    expect(await screen.findByText('Greeting')).toBeInTheDocument();
    expect(await screen.findByText('Checking for more native chats…')).toBeInTheDocument();
    expect(await screen.findByText('New native chat', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(fetchHistoryMock).toHaveBeenLastCalledWith('owner', 'repo', 'blueprint', 20, 0, false);
    expect(screen.queryByText('Checking for more native chats…')).not.toBeInTheDocument();
  });

  it('shows progress while the initial history list is loading', async () => {
    let resolveHistory!: (sessions: SessionHistorySummary[]) => void;
    fetchHistoryMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHistory = resolve;
    }) as never);

    setup();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading history…');
    expect(status.parentElement).toHaveClass(
      'flex',
      'h-full',
      'items-center',
      'justify-center',
    );

    await act(async () => resolveHistory([session()]));
    expect(await screen.findByText('Greeting')).toBeInTheDocument();
  });

  it('loads every tier and shows tier-specific status', async () => {
    fetchHistoryMock.mockResolvedValue([
      session({ id: 'active', title: 'Active session', tier: 'active' }),
      session({ id: 'review', title: 'Needs review', tier: 'waiting_for_review' }),
      session({ id: 'done', title: 'Completed session' }),
    ] as never);
    setup();
    expect(await screen.findByText('Active session')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Completed session')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('separates unread responses from errors and requests for input', async () => {
    fetchHistoryMock.mockResolvedValue([session({ id: 'a' }), session({ id: 'b' })] as never);
    attention.entries = [
      { id: 'a', owner: 'owner', repository: 'repo', blueprint: 'blueprint', revision: '1', state: 'needs_input', unread: false },
      { id: 'b', owner: 'owner', repository: 'repo', blueprint: 'blueprint', revision: '2', state: 'error', unread: true },
    ];
    setup();
    expect(await screen.findByText('Needs input')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getAllByText('Unread')).toHaveLength(1);
  });

  it('opens rows with mouse and keyboard without action-button bubbling', async () => {
    const props = setup();
    const row = await screen.findByRole('button', { name: /Greeting/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    await waitFor(() => expect(props.onSelectSession).toHaveBeenCalledWith('conversation-1'));
    expect(props.onSelectSession).toHaveBeenCalledOnce();
    // The row's own action buttons must not bubble into row selection.
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Fuse' }));
    await waitFor(() => expect(deleteHistoryMock).toHaveBeenCalledWith('conversation-1'));
    expect(props.onSelectSession).toHaveBeenCalledOnce();
  });

  it('offers no share affordance (there is no share server on the desktop)', async () => {
    setup();
    await screen.findByText('Greeting');
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
  });

  it('deletes a row and resets the active session', async () => {
    const props = setup({ activeSessionId: 'conversation-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Fuse' }));
    await waitFor(() => expect(deleteHistoryMock).toHaveBeenCalledWith('conversation-1'));
    expect(screen.queryByText('Greeting')).not.toBeInTheDocument();
    expect(props.onNewChat).toHaveBeenCalledOnce();
  });

  it('keeps the session visible and reports safe open/delete errors', async () => {
    const onSelectSession = vi.fn().mockRejectedValue(new Error('private traceback'));
    deleteHistoryMock.mockRejectedValue(new Error('private delete'));
    setup({ onSelectSession });
    fireEvent.click(await screen.findByRole('button', { name: /Greeting/ }));
    expect(await screen.findByText('Could not open that session. Please try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Fuse' }));
    expect(await screen.findByText('Could not delete session. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Greeting')).toBeInTheDocument();
    expect(screen.queryByText(/traceback|private delete/i)).not.toBeInTheDocument();
  });

  it('paginates in batches of 20 and preserves rows on failure', async () => {
    fetchHistoryMock
      .mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => session({
        id: `session-${index}`, title: `Session ${index}`,
      })) as never)
      .mockRejectedValueOnce(new Error('database'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Could not load more sessions. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Session 0')).toBeInTheDocument();
    expect(fetchHistoryMock).toHaveBeenLastCalledWith('owner', 'repo', 'blueprint', 20, 20);
  });

  it('reloads on the shared history-changed event', async () => {
    fetchHistoryMock.mockResolvedValueOnce([] as never).mockResolvedValueOnce([
      session({ title: 'Fresh session' }),
    ] as never);
    setup();
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent(SESSION_HISTORY_CHANGED_EVENT)));
    expect(await screen.findByText('Fresh session')).toBeInTheDocument();
  });

  it('finishes loading when a silent reload supersedes the initial request', async () => {
    let resolveInitial!: (sessions: SessionHistorySummary[]) => void;
    let resolveSilent!: (sessions: SessionHistorySummary[]) => void;
    fetchHistoryMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveInitial = resolve;
      }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSilent = resolve;
      }) as never);

    setup({ sessionStatus: 'completed' });
    await waitFor(() => expect(fetchHistoryMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveInitial([session({ title: 'Stale session' })]);
      resolveSilent([session({ title: 'Latest session' })]);
    });

    expect(await screen.findByText('Latest session')).toBeInTheDocument();
    expect(screen.queryByText('Stale session')).not.toBeInTheDocument();
  });

  it('hides New chat in read-only mode', async () => {
    setup({ readOnly: true });
    await screen.findByText('Greeting');
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
  });
});
