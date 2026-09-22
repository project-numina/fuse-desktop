/**
 * Lean Infoview panel: renders proof goals and diagnostics for the cursor
 * position in the open Lean file.
 *
 * Uses `--build-warning` for warning-tinted error/incomplete notes and
 * `animate-pulse` for loading placeholders.
 */

import { Button } from '@/components/ui/button';
import type { DiagnosticItem } from '@/features/blueprint/hooks/infoview';

export interface InfoviewPanelProps {
  goals?: string[];
  goalsBefore?: string[];
  goalsAfter?: string[];
  expectedType?: string;
  lineContext?: string;
  diagnostics?: DiagnosticItem[];
  diagnosticsIncomplete?: boolean;
  loading?: boolean;
  error?: string | null;
  onSetupLean?: () => void;
  /** Jump the editor caret to a diagnostic's (line, column). */
  onJump?: (payload: { line: number; column: number }) => void;
}

function severityMarkerColor(severity: string): string {
  if (severity === 'error') return 'var(--build-error)';
  if (severity === 'warning') return 'var(--build-warning)';
  return 'var(--numina-info)';
}

function InfoviewPanel({
  goals = [],
  goalsBefore = [],
  goalsAfter = [],
  expectedType = '',
  lineContext = '',
  diagnostics = [],
  diagnosticsIncomplete = false,
  loading = false,
  error = null,
  onSetupLean,
  onJump,
}: InfoviewPanelProps) {
  const hasAnyGoalData =
    goals.length > 0
    || goalsBefore.length > 0
    || goalsAfter.length > 0
    || Boolean(expectedType);

  const goalClass =
    'm-0 p-0 bg-transparent border-0 font-[var(--numina-font-mono)] '
    + 'text-[length:var(--text-xs)] leading-[1.55] whitespace-pre-wrap '
    + '[overflow-wrap:anywhere] text-[color:var(--text-primary)]';
  const sectionTitleClass =
    'flex items-center gap-[var(--space-2)] m-0 mb-[var(--space-2)] '
    + 'font-[var(--font-weight-semibold)] text-[length:var(--text-sm)] '
    + 'text-[color:var(--text-primary)]';
  const sectionCountClass =
    'inline-flex items-center justify-center min-w-[18px] h-4 px-[5px] '
    + 'text-[0.625rem] font-[var(--font-weight-medium)] text-[color:var(--text-muted)] '
    + 'bg-[var(--numina-border-light)] rounded-lg';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="overflow-y-auto overflow-x-hidden px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-xs)] flex-1 min-w-0 min-h-0">
        {error ? (
          <div className="text-center py-[var(--space-4)] text-[length:var(--text-sm)] text-[color:var(--build-warning)]">
            <p>{error}</p>
            {onSetupLean && <Button size="sm" className="mt-3" onClick={onSetupLean}>Set up Lean</Button>}
          </div>
        ) : loading && !hasAnyGoalData && !lineContext ? (
          <div className="flex flex-col gap-[var(--space-2)] py-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[color:var(--text-muted)] font-[var(--font-weight-semibold)] uppercase tracking-[0.05em] mb-[var(--space-1)]">
              <span>Querying Lean server…</span>
            </div>
            <div className="h-3 w-[70%] rounded-[var(--radius-sm)] bg-[var(--numina-border-light)] animate-pulse" />
            <div className="h-[34px] w-full rounded-[var(--radius-sm)] bg-[var(--numina-border-light)] animate-pulse" />
            <div className="h-[34px] w-[55%] rounded-[var(--radius-sm)] bg-[var(--numina-border-light)] animate-pulse" />
            <p className="mt-[var(--space-2)] mb-0 text-[0.6875rem] italic text-[color:var(--text-muted)] leading-[1.4]">
              First query after the server starts can take 30–60 seconds while
              the file elaborates.
            </p>
          </div>
        ) : (
          <>
            {goals.length > 0 ? (
              <section className="mb-[var(--space-4)]">
                <h3 className={sectionTitleClass}>
                  <span>Goal{goals.length > 1 ? 's' : ''}</span>
                  {goals.length > 1 ? (
                    <span className={sectionCountClass}>{goals.length}</span>
                  ) : null}
                </h3>
                {goals.map((goal, index) => (
                  <pre
                    key={`g-${index}`}
                    className={`${goalClass} [&+&]:mt-[var(--space-3)] [&+&]:pt-[var(--space-3)] [&+&]:border-t [&+&]:border-[var(--numina-border-light)]`}
                  >
                    {goal}
                  </pre>
                ))}
              </section>
            ) : goalsBefore.length > 0 || goalsAfter.length > 0 ? (
              <section className="mb-[var(--space-4)]">
                {goalsBefore.length > 0 ? (
                  <div>
                    <h3 className={sectionTitleClass}>Before</h3>
                    {goalsBefore.map((goal, index) => (
                      <pre key={`gb-${index}`} className={goalClass}>
                        {goal}
                      </pre>
                    ))}
                  </div>
                ) : null}
                {goalsAfter.length > 0 ? (
                  <div className={goalsBefore.length > 0 ? 'mt-[var(--space-3)]' : ''}>
                    <h3 className={sectionTitleClass}>After</h3>
                    {goalsAfter.map((goal, index) => (
                      <pre key={`ga-${index}`} className={goalClass}>
                        {goal}
                      </pre>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : expectedType ? (
              <section className="mb-[var(--space-4)]">
                <h3 className={sectionTitleClass}>Goal</h3>
                <pre className={goalClass}>{expectedType}</pre>
              </section>
            ) : !hasAnyGoalData && !loading ? (
              <section className="mb-[var(--space-4)]">
                <h3 className={sectionTitleClass}>Goal</h3>
                <div className="text-[color:var(--text-muted)] text-[length:var(--text-xs)] leading-[1.6] py-[var(--space-2)]">
                  No goals at cursor. Click inside a proof body or expression to
                  inspect it.
                </div>
              </section>
            ) : null}

            {diagnosticsIncomplete ? (
              <div className="mb-[var(--space-2)] text-[0.6875rem] italic text-[color:var(--build-warning)] leading-[1.4]">
                Lean is still checking this file — messages may be incomplete.
              </div>
            ) : null}

            {diagnostics.length > 0 ? (
              <section className="mb-[var(--space-4)] mt-[var(--space-4)] pt-[var(--space-4)] border-t border-[var(--numina-border)]">
                <h3 className={sectionTitleClass}>
                  <span>Messages</span>
                  <span className={sectionCountClass}>{diagnostics.length}</span>
                </h3>
                {diagnostics.map((item, index) => (
                  <div
                    key={`d-${index}`}
                    className="font-[var(--numina-font-mono)] text-[length:var(--text-xs)] leading-[1.45] [&+div]:mt-[var(--space-3)] [&+div]:pt-[var(--space-3)] [&+div]:border-t [&+div]:border-dashed [&+div]:border-[var(--numina-border-light)]"
                  >
                    <button
                      type="button"
                      className="group inline-flex items-center gap-[var(--space-2)] m-0 mb-[2px] p-0 bg-transparent border-0 font-inherit font-[var(--font-weight-semibold)] text-inherit text-left cursor-pointer"
                      title={`Jump to line ${item.line}`}
                      onClick={() => onJump?.({ line: item.line, column: item.column })}
                    >
                      <span
                        className="inline-block w-1 h-3 rounded-[2px] shrink-0"
                        style={{ background: severityMarkerColor(item.severity) }}
                      />
                      <span className="text-[color:var(--text-muted)] tabular-nums group-hover:text-[color:var(--text-primary)] group-hover:underline">
                        {item.line}:{item.column}
                      </span>
                    </button>
                    <pre className="m-0 p-0 bg-transparent border-0 text-[color:var(--text-primary)] font-[var(--numina-font-mono)] text-[length:var(--text-xs)] leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {item.message}
                    </pre>
                  </div>
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default InfoviewPanel;
