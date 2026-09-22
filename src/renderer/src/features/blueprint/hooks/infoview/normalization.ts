import type {
  DiagnosticItem,
  DiagnosticResponse,
  GoalResponse,
  InfoviewState,
} from './types';

const FAILED_DEPENDENCIES_PREFIX = 'Imported dependencies failed to build: ';

function failedDependenciesItem(failedDependencies: string[]): DiagnosticItem {
  return {
    severity: 'error',
    message: FAILED_DEPENDENCIES_PREFIX + failedDependencies.join(', '),
    line: 1,
    column: 1,
  };
}

function isFailedDependenciesItem(item: DiagnosticItem): boolean {
  return item.line === 1
    && item.column === 1
    && item.severity === 'error'
    && item.message.startsWith(FAILED_DEPENDENCIES_PREFIX);
}

export function diagnosticsWithFailedDependencies(
  diagnostics: DiagnosticItem[],
  failedDependencies: string[],
): DiagnosticItem[] {
  if (failedDependencies.length === 0) return diagnostics;
  return [
    failedDependenciesItem(failedDependencies),
    ...diagnostics.filter((item) => !isFailedDependenciesItem(item)),
  ];
}

export function applyGoalResponse(state: InfoviewState, result: GoalResponse): void {
  state.lineContext = result.line_context || '';
  state.goals = result.goals || [];
  state.goalsBefore = result.goals_before || [];
  state.goalsAfter = result.goals_after || [];
  state.expectedType = result.expected_type || '';
}

/**
 * Provisional LSP results keep the last authoritative squiggles. Failed
 * imports are independent evidence, so they may still be merged into them.
 */
export function applyDiagnosticResponse(
  state: InfoviewState,
  result: DiagnosticResponse,
): void {
  const failedDependencies = result.failed_dependencies || [];
  if (result.complete === false) {
    state.diagnostics = diagnosticsWithFailedDependencies(
      state.diagnostics,
      failedDependencies,
    );
    state.diagnosticsIncomplete = true;
    return;
  }

  state.diagnostics = diagnosticsWithFailedDependencies(
    [...(result.items || [])],
    failedDependencies,
  );
  state.diagnosticsIncomplete = false;
}
