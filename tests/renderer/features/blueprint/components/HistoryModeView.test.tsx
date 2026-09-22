import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryModeView } from '@/features/blueprint/components/HistoryModeView';
import type { HistoryModeController } from '@/features/blueprint/components/use-history-mode';

vi.mock('@/hooks/use-session-attention', () => ({
  useSessionAttention: () => [],
}));

function controller(overrides: Partial<HistoryModeController> = {}): HistoryModeController {
  return {
    sessions: [], historyLoading: false, historyError: null, nativeWarnings: [], nativeRefreshing: false,
    actionError: null, loadingMore: false, hasMore: false,
    selectSession: vi.fn(), deleteSession: vi.fn(), loadMore: vi.fn(), ...overrides,
  };
}

describe('HistoryModeView', () => {
  it('renders loading and error seams without session actions', () => {
    const { rerender } = render(<HistoryModeView {...controller({ historyLoading: true })} readOnly={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history…');
    rerender(<HistoryModeView {...controller({ historyError: 'Could not load.' })} readOnly={false} />);
    expect(screen.getByText('Could not load.')).toBeInTheDocument();
  });

  it('renders the empty state and preserves the New chat action', () => {
    const onNewChat = vi.fn();
    render(<HistoryModeView {...controller()} readOnly={false} onNewChat={onNewChat} />);
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});
