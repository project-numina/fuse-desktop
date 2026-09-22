/**
 * Desktop signals that a conversation needs the user: a quiet completion
 * badge, native notifications for errors/permissions, and keeping the
 * machine awake while a turn runs. The sessions service feeds it the
 * provider-neutral events and the route to open when a notification is clicked.
 */

import { app, BrowserWindow, Notification, powerSaveBlocker } from 'electron';
import type { AgentEvent } from '@shared/agent-events';
import { DEFAULT_NOTIFICATIONS, type NotificationPreferences } from '@shared/desktop';
import { focusAppWindow, sendMenuCommand, type WindowFactory } from './menu';

export class AttentionTracker {
  private readonly needsAttention = new Set<string>();
  private readonly busy = new Set<string>();
  private blockerId: number | null = null;

  constructor(
    private readonly titleOf: (threadId: string) => string,
    /** App route to open for a conversation, e.g. /repo/o/r/blueprint/x?chat=<id>. */
    private readonly routeOf: (threadId: string) => string | null,
    /** Creates the app window when a click arrives after it was closed (macOS). */
    private readonly ensureWindow: WindowFactory,
    private readonly preferences: () => NotificationPreferences = () => DEFAULT_NOTIFICATIONS,
  ) {}

  observe(threadId: string, event: AgentEvent): void {
    switch (event.kind) {
      case 'turn_started':
        this.busy.add(threadId);
        this.updateBlocker();
        return;
      case 'turn_completed':
      case 'turn_failed':
      case 'turn_interrupted':
        this.busy.delete(threadId);
        this.updateBlocker();
        if (event.kind === 'turn_interrupted') return;
        if (event.kind === 'turn_failed') {
          this.notify(threadId, 'failed', 'Turn failed', event.message);
        } else {
          this.notify(threadId, 'completed', 'Turn complete', 'Your agent has finished.');
        }
        return;
      case 'permission_request':
        this.notify(threadId, 'permission', 'Permission needed', `${event.tool}: ${event.description ?? 'approve or deny in Fuse'}`);
        return;
      default:
        return;
    }
  }

  /** The durable session read receipts are the only source of badge counts. */
  setUnread(conversationIds: string[]): void {
    this.needsAttention.clear();
    for (const id of conversationIds) this.needsAttention.add(id);
    this.updateBadge();
  }

  private windowFocused(): boolean {
    return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused());
  }

  private notify(threadId: string, kind: 'completed' | 'failed' | 'permission', title: string, body: string): void {
    const preferences = this.preferences();
    if (!preferences[kind]) return;
    if (this.windowFocused()) return;
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: `${title} · ${this.titleOf(threadId)}`, body, silent: !preferences.sound });
    notification.on('click', () => {
      const path = this.routeOf(threadId);
      if (path) sendMenuCommand({ kind: 'navigate', path }, this.ensureWindow);
      else focusAppWindow(this.ensureWindow);
    });
    notification.show();
  }

  private updateBadge(): void {
    const count = this.needsAttention.size;
    if (process.platform === 'darwin') {
      app.dock?.setBadge(count ? String(count) : '');
    } else {
      app.setBadgeCount(count);
    }
  }

  private updateBlocker(): void {
    if (this.busy.size > 0 && this.blockerId === null) {
      this.blockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (this.busy.size === 0 && this.blockerId !== null) {
      powerSaveBlocker.stop(this.blockerId);
      this.blockerId = null;
    }
  }
}
