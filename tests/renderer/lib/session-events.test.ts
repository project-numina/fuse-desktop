import { describe, expect, it, vi } from 'vitest';

import { notifySessionHistoryChanged, SESSION_HISTORY_CHANGED_EVENT } from '@/lib/session-events';

describe('session history events', () => {
  it('dispatches the changed session id', () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_HISTORY_CHANGED_EVENT, listener);
    notifySessionHistoryChanged('session-42');
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ sessionId: 'session-42' });
    window.removeEventListener(SESSION_HISTORY_CHANGED_EVENT, listener);
  });
});
