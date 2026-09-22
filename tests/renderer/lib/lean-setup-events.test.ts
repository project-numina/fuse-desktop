import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LEAN_SETUP_READY_EVENT,
  OPEN_LEAN_SETUP_EVENT,
  openLeanSetup,
  type LeanSetupTarget,
} from '@/lib/lean-setup-events';

const listeners: Array<{ type: string; listener: EventListener }> = [];

function listen(type: string, listener: EventListener): void {
  window.addEventListener(type, listener);
  listeners.push({ type, listener });
}

afterEach(() => {
  for (const { type, listener } of listeners.splice(0)) {
    window.removeEventListener(type, listener);
  }
});

describe('lean setup events', () => {
  it('exports stable event names for open and ready notifications', () => {
    expect(OPEN_LEAN_SETUP_EVENT).toBe('fuse:open-lean-setup');
    expect(LEAN_SETUP_READY_EVENT).toBe('fuse:lean-setup-ready');
  });

  it('dispatches a CustomEvent containing the exact setup target', () => {
    const listener = vi.fn();
    listen(OPEN_LEAN_SETUP_EVENT, listener);
    const target: LeanSetupTarget = {
      owner: 'numina',
      repo: 'math',
      blueprintId: 'froda',
    };

    openLeanSetup(target);

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent<LeanSetupTarget>;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe(OPEN_LEAN_SETUP_EVENT);
    expect(event.detail).toBe(target);
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
  });

  it('does not dispatch the ready event or normalize edge-case identifiers', () => {
    const openListener = vi.fn();
    const readyListener = vi.fn();
    listen(OPEN_LEAN_SETUP_EVENT, openListener);
    listen(LEAN_SETUP_READY_EVENT, readyListener);
    const edgeTarget = { owner: '', repo: 'repo with spaces', blueprintId: '../raw' };

    openLeanSetup(edgeTarget);

    expect(openListener).toHaveBeenCalledOnce();
    expect((openListener.mock.calls[0][0] as CustomEvent).detail).toEqual(edgeTarget);
    expect(readyListener).not.toHaveBeenCalled();
  });

  it('forwards malformed runtime input as event detail without throwing', () => {
    const listener = vi.fn();
    listen(OPEN_LEAN_SETUP_EVENT, listener);

    expect(() => openLeanSetup(undefined as unknown as LeanSetupTarget)).not.toThrow();
    // The DOM CustomEvent constructor normalizes an omitted/undefined detail
    // to null; the helper deliberately performs no validation of its own.
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBeNull();
  });
});
