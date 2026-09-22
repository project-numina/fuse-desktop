import { describe, expect, it } from 'vitest';
import { addFutureSteps, buildPhaseToStep } from '@/features/chat/state/builds';
import type { BuildActivity } from '@/features/chat/state/types';

const build = (): BuildActivity => ({
  title: 'Preparing Lean environment', status: 'running', turnId: 'turn-0', steps: [],
});

describe('build state helpers', () => {
  it.each([
    ['preparing', 'Preparing workspace'], ['cloning', 'Setting up project'],
    ['fetching', 'Updating project files'], ['linking_deps', 'Loading Lean dependencies'],
    ['downloading_cache', 'Downloading Mathlib cache'], ['building', 'Building Lean environment'],
  ])('maps %s to a display step', (phase, label) => {
    expect(buildPhaseToStep(phase)).toBe(label);
  });

  it('rejects unknown and absent phases', () => {
    expect(buildPhaseToStep('failed')).toBeNull();
    expect(buildPhaseToStep(null)).toBeNull();
    expect(buildPhaseToStep(undefined)).toBeNull();
  });

  it('adds expected future steps using fresh objects', () => {
    const first = build();
    const second = build();
    addFutureSteps(first, 'cloning');
    addFutureSteps(second, 'cloning');
    expect(first.steps.map((step) => step.label)).toEqual([
      'Preparing workspace', 'Loading Lean dependencies', 'Building Lean environment',
    ]);
    expect(first.steps[0]).not.toBe(second.steps[0]);
  });

  it('does not duplicate existing steps or mutate unknown phases', () => {
    const value = build();
    value.steps.push({ label: 'Loading Lean dependencies', status: 'done' });
    addFutureSteps(value, 'preparing');
    addFutureSteps(value, 'building');
    expect(value.steps).toEqual([
      { label: 'Loading Lean dependencies', status: 'done' },
      { label: 'Building Lean environment', status: 'pending' },
    ]);
  });
});
