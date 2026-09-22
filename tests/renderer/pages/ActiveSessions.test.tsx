import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveSessionSummary } from '@/lib/api';

interface ActiveSessionsViewState {
  loading: boolean;
  sessions: ActiveSessionSummary[];
  activeCount: number;
  maxActive: number;
  error: string | null;
  cancelRequestedIds: Set<string>;
  reason: 'manual' | 'cap_hit';
}

const activeSessions = vi.hoisted(() => ({
  state: null as unknown as ActiveSessionsViewState,
  setReason: vi.fn(),
  refresh: vi.fn(async () => undefined),
  cancelOne: vi.fn(async () => undefined),
}));

vi.mock('@/state/active-sessions', () => ({
  useActiveSessions: () => activeSessions,
}));
vi.mock('@/components/layout/AppHeader', () => ({
  default: () => <header>application header</header>,
}));
vi.mock('@/components/layout/AppFooter', () => ({
  default: () => <footer>application footer</footer>,
}));

import ActiveSessions, { activeSessionStatusTone } from '@/pages/ActiveSessions';

const session = (
  overrides: Partial<ActiveSessionSummary> = {},
): ActiveSessionSummary => ({
  session_id: 'session-1',
  conversation_id: 'conversation-1',
  agent_job_id: 'job-1',
  repository_owner: 'numina',
  repository_name: 'fuse',
  blueprint_name: 'example',
  workspace_label: 'Example workspace',
  status: 'running',
  execution_mode: 'background',
  turn_active: false,
  created_at: '2026-07-27T12:00:00Z',
  can_send: false,
  can_cancel: true,
  display_status: 'Ready for messages.',
  ...overrides,
});

function state(overrides: Partial<ActiveSessionsViewState> = {}): ActiveSessionsViewState {
  return {
    loading: false,
    sessions: [],
    activeCount: 0,
    maxActive: 0,
    error: null,
    cancelRequestedIds: new Set<string>(),
    reason: 'manual',
    ...overrides,
  };
}

function page(path = '/active-sessions'): ReactElement {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ActiveSessions />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  activeSessions.state = state();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('activeSessionStatusTone', () => {
  it('keeps cancellation as the highest-priority state', () => {
    expect(activeSessionStatusTone(session({ turn_active: true }), true)).toBe('stopping');
  });

  it('shows direct, delegated, and prover work as active', () => {
    expect(activeSessionStatusTone(session({ turn_active: true }), false)).toBe('working');
    expect(activeSessionStatusTone(session({ active_work_group_count: 1 }), false)).toBe('working');
    expect(activeSessionStatusTone(session({ active_prover_batch_id: 'batch-1' }), false)).toBe('working');
  });

  it('distinguishes starting, idle, and stopped sessions', () => {
    expect(activeSessionStatusTone(session({ status: 'starting' }), false)).toBe('starting');
    expect(activeSessionStatusTone(session({ status: 'running', active_work_group_count: 0 }), false)).toBe('idle');
    expect(activeSessionStatusTone(session({ status: 'completed' }), false)).toBe('stopped');
  });
});

describe('ActiveSessions', () => {
  it('shows the initial loading state and records a manual visit', () => {
    activeSessions.state = state({ loading: true });
    render(page());

    expect(screen.getByText('application header')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Active sessions' })).toBeInTheDocument();
    expect(screen.getByText('These chats are currently using a session slot.')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    expect(screen.getByText('application footer')).toBeInTheDocument();
    expect(activeSessions.setReason).toHaveBeenCalledWith('manual');
    expect(activeSessions.refresh).toHaveBeenCalledOnce();
  });

  it('shows errors together with the empty state and session limit', () => {
    activeSessions.state = state({
      activeCount: 0,
      maxActive: 4,
      error: 'Could not load active sessions.',
    });
    render(page('/active-sessions?reason=unexpected'));

    expect(screen.getByText('0/4')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load active sessions.');
    expect(screen.getByText('No active sessions')).toBeInTheDocument();
    expect(screen.getByText('Chats you start will appear here while they run.')).toBeInTheDocument();
    expect(activeSessions.setReason).toHaveBeenCalledWith('manual');
  });

  it('uses the cap-hit query reason and renders its warning as an alert', () => {
    activeSessions.state = state({ reason: 'cap_hit', activeCount: 2, maxActive: 2 });
    render(page('/active-sessions?reason=cap_hit'));

    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "You've reached the limit on concurrent sessions. Cancel one to start a new chat.",
    );
    expect(activeSessions.setReason).toHaveBeenCalledWith('cap_hit');
  });

  it('renders live sessions during refresh and wires cancellation by session id', () => {
    activeSessions.state = state({
      loading: true,
      activeCount: 3,
      maxActive: 5,
      cancelRequestedIds: new Set(['session-3']),
      sessions: [
        session({
          session_id: 'session-1',
          repository_owner: 'numina',
          repository_name: 'fuse',
          workspace_label: 'Proof workspace',
          turn_active: true,
          display_status: 'Running proof',
        }),
        session({
          session_id: 'session-2',
          repository_owner: 'leanprover',
          repository_name: 'mathlib4',
          workspace_label: 'Read-only workspace',
          status: 'starting',
          can_cancel: false,
          display_status: 'Starting agent',
        }),
        session({
          session_id: 'session-3',
          repository_owner: 'numina',
          repository_name: 'experiments',
          workspace_label: 'Cancelling workspace',
          status: 'failed',
          display_status: 'Failed',
        }),
      ],
    });
    render(page());

    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByText('numina/fuse')).toBeInTheDocument();
    expect(screen.getByTitle('Proof workspace')).toBeInTheDocument();
    expect(screen.getByText('Running proof')).toBeInTheDocument();
    expect(screen.getByText('Starting agent')).toBeInTheDocument();
    expect(screen.getByText('Cancel requested…')).toBeInTheDocument();

    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancelButtons).toHaveLength(2);
    expect(cancelButtons[0]).toBeEnabled();
    expect(cancelButtons[1]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();

    fireEvent.click(cancelButtons[0]);
    expect(activeSessions.cancelOne).toHaveBeenCalledOnce();
    expect(activeSessions.cancelOne).toHaveBeenCalledWith('session-1');
  });

  it('pauses polling while loading or hidden, refreshes when visible, and cleans up', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const view = render(page());
    expect(activeSessions.refresh).toHaveBeenCalledOnce();

    hidden.mockReturnValue(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(activeSessions.refresh).toHaveBeenCalledOnce();

    hidden.mockReturnValue(false);
    activeSessions.state = state({ loading: true });
    view.rerender(page());
    act(() => vi.advanceTimersByTime(5000));
    expect(activeSessions.refresh).toHaveBeenCalledOnce();

    activeSessions.state = state({ loading: false });
    view.rerender(page());
    act(() => vi.advanceTimersByTime(5000));
    expect(activeSessions.refresh).toHaveBeenCalledTimes(2);

    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(activeSessions.refresh).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(activeSessions.refresh).toHaveBeenCalledTimes(3);

    view.unmount();
    act(() => vi.advanceTimersByTime(5000));
    fireEvent(document, new Event('visibilitychange'));
    expect(activeSessions.refresh).toHaveBeenCalledTimes(3);
  });
});
