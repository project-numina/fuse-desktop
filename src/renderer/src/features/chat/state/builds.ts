/**
 * Lean build-progress step helpers, shared by the live SSE handler (which
 * appends steps as `build_status` events arrive) and history reconstruction
 * (which rebuilds the same step list from the persisted transcript).
 */

import type { BuildActivity, BuildStep } from '@/features/chat/state/types';

export function buildPhaseToStep(phase: string | null | undefined): string | null {
  switch (phase) {
    case 'preparing':
      return 'Preparing workspace';
    case 'cloning':
      return 'Setting up project';
    case 'fetching':
      return 'Updating project files';
    case 'linking_deps':
      return 'Loading Lean dependencies';
    case 'downloading_cache':
      return 'Downloading Mathlib cache';
    case 'building':
      return 'Building Lean environment';
    default:
      return null;
  }
}

/**
 * Steps that are expected to follow a given phase.
 * Used to pre-populate the build card so users see what's coming.
 */
const EXPECTED_FUTURE_STEPS: Record<string, BuildStep[]> = {
  cloning: [
    { label: 'Preparing workspace', status: 'pending' },
    { label: 'Loading Lean dependencies', status: 'pending' },
    { label: 'Building Lean environment', status: 'pending' },
  ],
  fetching: [
    { label: 'Preparing workspace', status: 'pending' },
    { label: 'Loading Lean dependencies', status: 'pending' },
    { label: 'Building Lean environment', status: 'pending' },
  ],
  preparing: [
    { label: 'Loading Lean dependencies', status: 'pending' },
    { label: 'Building Lean environment', status: 'pending' },
  ],
  linking_deps: [
    { label: 'Building Lean environment', status: 'pending' },
  ],
  downloading_cache: [
    { label: 'Building Lean environment', status: 'pending' },
  ],
};

/**
 * Add expected future steps to a build card, skipping any already present.
 */
export function addFutureSteps(build: BuildActivity, phase: string): void {
  const future = EXPECTED_FUTURE_STEPS[phase];
  if (!future) return;
  const existing = new Set(build.steps.map((step) => step.label));
  for (const step of future) {
    if (!existing.has(step.label)) {
      build.steps.push({ ...step });
    }
  }
}
