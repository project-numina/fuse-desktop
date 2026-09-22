import { describe, expect, it } from 'vitest';

import {
  applyDiagnosticResponse,
  applyGoalResponse,
} from '@/features/blueprint/hooks/infoview/normalization';
import { initialInfoviewState } from '@/features/blueprint/hooks/infoview/types';

describe('infoview response normalization', () => {
  it('normalizes nullable goal fields', () => {
    const state = initialInfoviewState();
    applyGoalResponse(state, {
      line_context: null,
      goals: ['⊢ True'],
      goals_before: null,
      goals_after: null,
      expected_type: null,
    });

    expect(state).toMatchObject({
      lineContext: '',
      goals: ['⊢ True'],
      goalsBefore: [],
      goalsAfter: [],
      expectedType: '',
    });
  });

  it('keeps authoritative diagnostics for provisional responses', () => {
    const state = initialInfoviewState();
    state.diagnostics = [{ severity: 'error', message: 'unsolved goals', line: 8, column: 3 }];
    applyDiagnosticResponse(state, {
      items: [{ severity: 'error', message: 'restart file', line: 1, column: 1 }],
      complete: false,
      failed_dependencies: ['Mathlib/Broken.lean'],
    });

    expect(state.diagnostics.map(({ message }) => message)).toEqual([
      'Imported dependencies failed to build: Mathlib/Broken.lean',
      'unsolved goals',
    ]);
    expect(state.diagnosticsIncomplete).toBe(true);
  });

  it('replaces diagnostics when the verdict is complete', () => {
    const state = initialInfoviewState();
    state.diagnostics = [{ severity: 'error', message: 'old', line: 1, column: 1 }];
    state.diagnosticsIncomplete = true;
    applyDiagnosticResponse(state, {
      items: [{ severity: 'warning', message: 'new', line: 2, column: 4 }],
      complete: true,
    });

    expect(state.diagnostics).toEqual([
      { severity: 'warning', message: 'new', line: 2, column: 4 },
    ]);
    expect(state.diagnosticsIncomplete).toBe(false);
  });
});
