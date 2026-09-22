import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_NOTIFICATIONS } from '@shared/desktop';

const mocks = vi.hoisted(() => ({
  focused: false,
  badge: vi.fn(), flash: vi.fn(), show: vi.fn(), notification: vi.fn(), start: vi.fn(() => 1), stop: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { dock: { setBadge: mocks.badge }, setBadgeCount: mocks.badge },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, isFocused: () => mocks.focused, flashFrame: mocks.flash }] },
  Notification: class { constructor(options: unknown) { mocks.notification(options); } static isSupported() { return true; } on() {} show() { mocks.show(); } },
  powerSaveBlocker: { start: mocks.start, stop: mocks.stop },
}));
vi.mock('@main/menu', () => ({ focusAppWindow: vi.fn(), sendMenuCommand: vi.fn() }));
import { AttentionTracker } from '@main/attention';

const completed: AgentEvent = { kind: 'turn_completed', turnId: 'turn', at: 0, stopReason: null, durationMs: null, costUsd: null };
describe('quiet completion attention', () => {
  it('reads notification preferences live and applies sound independently', () => {
    const preferences = { ...DEFAULT_NOTIFICATIONS, completed: true, sound: false };
    const attention = new AttentionTracker(() => 'Test', () => null, vi.fn(), () => preferences);
    attention.observe('a', completed);
    expect(mocks.notification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Turn complete · Test', silent: true }));
    preferences.completed = false;
    preferences.failed = false;
    attention.observe('b', completed);
    attention.observe('b', { kind: 'turn_failed', turnId: 'turn', at: 0, message: 'Failed' });
    expect(mocks.show).toHaveBeenCalledOnce();
    preferences.completed = true;
    mocks.focused = true;
    attention.observe('c', completed);
    expect(mocks.show).toHaveBeenCalledOnce();
  });
  it('can suppress approval notifications without changing approval behavior', () => {
    const preferences = { ...DEFAULT_NOTIFICATIONS, permission: false };
    const attention = new AttentionTracker(() => 'Test', () => null, vi.fn(), () => preferences);
    const event: AgentEvent = { kind: 'permission_request', turnId: 't', requestId: 'r', toolCallId: null, tool: 'Bash', input: {}, description: null, reason: null, suggestions: [], at: 0 };
    attention.observe('a', event);
    expect(mocks.show).not.toHaveBeenCalled();
    preferences.permission = true;
    attention.observe('a', event);
    expect(mocks.show).toHaveBeenCalledOnce();
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.focused = false; });
  const tracker = () => new AttentionTracker(() => 'Test', () => null, vi.fn());
  it('badges unread conversations without bouncing or a notification', () => {
    const attention = tracker();
    attention.observe('a', { kind: 'turn_started', turnId: 'turn', at: 0 });
    attention.observe('a', completed);
    attention.observe('a', completed);
    attention.setUnread(['a', 'a']);
    expect(String(mocks.badge.mock.lastCall?.[0])).toBe('1');
    attention.observe('b', completed);
    attention.setUnread(['a', 'b']);
    expect(String(mocks.badge.mock.lastCall?.[0])).toBe('2');
    expect(mocks.flash).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledWith(1);
    attention.setUnread([]);
    expect(mocks.badge.mock.lastCall?.[0]).toBe(process.platform === 'darwin' ? '' : 0);
  });
  it('keeps unrelated unread chats badged even while the app is focused', () => {
    mocks.focused = true;
    const attention = tracker();
    attention.observe('a', completed);
    attention.setUnread(['a', 'b']);
    expect(String(mocks.badge.mock.lastCall?.[0])).toBe('2');
    attention.setUnread(['b']);
    expect(String(mocks.badge.mock.lastCall?.[0])).toBe('1');
    expect(mocks.show).not.toHaveBeenCalled();
  });
  it('still notifies on failures without flashing the window', () => {
    tracker().observe('a', { kind: 'turn_failed', turnId: 'turn', at: 0, message: 'Failed' });
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(mocks.flash).not.toHaveBeenCalled();
  });
});
