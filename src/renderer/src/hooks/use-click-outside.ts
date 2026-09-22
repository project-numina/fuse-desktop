/**
 * Dismiss-on-outside-interaction helper for popovers, dropdown menus, and
 * similar transient overlays.
 *
 * menus (the Account theme picker, the access-token expiry picker, the
 * feedback category picker) each re-implemented the same trio of listeners:
 * close on a mousedown outside the root, close on Escape, and tear the
 * listeners down on unmount. This hook centralizes that so callers only
 * provide the root element ref and a close callback.
 */

import { useEffect, type RefObject } from 'react';

interface UseClickOutsideOptions {
  /** Whether the overlay is open; listeners attach only while enabled. */
  enabled?: boolean;
  /** Also dismiss on Escape. Defaults to true. */
  dismissOnEscape?: boolean;
}

/**
 * Wire up outside-click and Escape dismissal for an overlay. Listeners are
 * added only while ``enabled`` is true and always removed on cleanup.
 *
 * @param ref The overlay root; interactions inside it are ignored.
 * @param onDismiss Invoked when the user clicks outside or presses Escape.
 * @param options Toggle enablement and Escape handling.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options: UseClickOutsideOptions = {},
): void {
  const { enabled = true, dismissOnEscape = true } = options;

  useEffect(() => {
    if (!enabled) return;

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      const root = ref.current;
      if (root && target && !root.contains(target)) {
        onDismiss();
      }
    }

    function handleKeydown(event: KeyboardEvent): void {
      if (dismissOnEscape && event.key === 'Escape') {
        onDismiss();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [ref, onDismiss, enabled, dismissOnEscape]);
}
