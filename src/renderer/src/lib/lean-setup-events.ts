export const LEAN_SETUP_READY_EVENT = 'fuse:lean-setup-ready';
export const OPEN_LEAN_SETUP_EVENT = 'fuse:open-lean-setup';

export interface LeanSetupTarget { owner: string; repo: string; blueprintId: string }

/** Open the confirmation dialog only; this never starts a build. */
export function openLeanSetup(target: LeanSetupTarget): void {
  window.dispatchEvent(new CustomEvent(OPEN_LEAN_SETUP_EVENT, { detail: target }));
}
