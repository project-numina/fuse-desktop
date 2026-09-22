import {
  BUILD_DISPLAY_PHASES,
  BUILD_SUBSTANTIVE_PHASES,
} from './activity';
import { addFutureSteps, buildPhaseToStep } from './builds';
import { objectPayload, parseSseEventData } from './sse';
import type {
  BuildActivity,
  BuildStep,
  ChatState,
  LiveBuildStatus,
} from './types';

interface BuildStateDependencies {
  state: ChatState;
  emit: () => void;
  currentTurnId: () => string | null;
  updateLiveBuildStatus: (status: LiveBuildStatus) => void;
  scrollToLatest: () => void;
}

interface BuildStateContext extends BuildStateDependencies {
  pendingSteps: Map<string, string[]>;
  liveTurnId: string | null | undefined;
}

interface BuildSnapshotStep {
  phase: string;
  message: string;
}

type BuildTerminalStatus = Extract<LiveBuildStatus, 'running' | 'done' | 'failed'>;

function ensureActivity(
  context: BuildStateContext,
  turnId: string | null,
): BuildActivity {
  const lastBuild = context.state.buildHistory.at(-1);
  if (lastBuild && lastBuild.turnId === turnId) return lastBuild;
  context.state.buildHistory = [...context.state.buildHistory, {
    title: 'Preparing Lean environment',
    status: 'running',
    turnId,
    steps: [],
  }];
  context.emit();
  return context.state.buildHistory.at(-1) as BuildActivity;
}

function getLiveTurnId(context: BuildStateContext): string | null {
  if (context.liveTurnId !== undefined) return context.liveTurnId;
  const lastBuild = context.state.buildHistory.at(-1);
  context.liveTurnId = lastBuild ? lastBuild.turnId : context.currentTurnId();
  return context.liveTurnId;
}

function replaceSteps(
  build: BuildActivity,
  snapshotSteps: BuildSnapshotStep[],
  terminalStatus: BuildTerminalStatus,
): void {
  const steps: BuildStep[] = [];
  for (const step of snapshotSteps) {
    const label = buildPhaseToStep(step.phase);
    if (!label || !BUILD_DISPLAY_PHASES.has(step.phase)) continue;
    const previous = steps.at(-1);
    if (previous?.status === 'running') previous.status = 'done';
    steps.push({ label, status: 'running' });
  }
  if (terminalStatus !== 'running') {
    for (const step of steps) {
      if (step.status === 'running') step.status = 'done';
    }
  }
  build.steps = steps;
  build.status = terminalStatus;
}

function finishLastStep(context: BuildStateContext): void {
  const lastBuild = context.state.buildHistory.at(-1);
  if (!lastBuild || lastBuild.status !== 'running') return;
  if (lastBuild.steps.length === 0) {
    context.state.buildHistory = context.state.buildHistory.slice(0, -1);
    context.emit();
    return;
  }
  for (const step of lastBuild.steps) {
    if (step.status === 'running') step.status = 'done';
  }
  lastBuild.steps = lastBuild.steps.filter((step) => step.status !== 'pending');
  lastBuild.status = 'done';
  context.emit();
}

function parseSnapshotSteps(event: Event): {
  status: unknown;
  steps: BuildSnapshotStep[];
} | null {
  const data = parseSseEventData<{ status?: unknown; steps?: unknown }>(event);
  if (!data || !Array.isArray(data.steps)) return null;
  const steps = data.steps
    .map((step) => objectPayload(step))
    .filter((step) => typeof step.phase === 'string')
    .map((step) => ({
      phase: step.phase as string,
      message: typeof step.message === 'string' ? step.message : '',
    }));
  return steps.length ? { status: data.status, steps } : null;
}

function snapshotStatus(status: unknown): BuildTerminalStatus {
  if (status === 'error') return 'failed';
  if (status === 'done') return 'done';
  return 'running';
}

function handleSnapshot(context: BuildStateContext, event: Event): void {
  const snapshot = parseSnapshotSteps(event);
  if (!snapshot) return;
  const build = ensureActivity(context, getLiveTurnId(context));
  const status = snapshotStatus(snapshot.status);
  replaceSteps(build, snapshot.steps, status);
  context.updateLiveBuildStatus(status);
  context.scrollToLatest();
}

function handleTerminalPhase(
  context: BuildStateContext,
  phase: string | null,
  turnId: string | null,
  turnKey: string,
): boolean {
  if (phase !== 'up_to_date' && phase !== 'failed') return false;
  context.pendingSteps.delete(turnKey);
  const status = phase === 'failed' ? 'failed' : 'done';
  context.updateLiveBuildStatus(status);
  const lastBuild = context.state.buildHistory.at(-1);
  if (phase === 'failed' && lastBuild?.turnId === turnId) {
    lastBuild.status = 'failed';
  } else if (lastBuild?.turnId === turnId && lastBuild.steps.length === 0) {
    context.state.buildHistory = context.state.buildHistory.slice(0, -1);
  }
  return true;
}

function showBuildPhase(
  context: BuildStateContext,
  turnId: string | null,
  phase: string,
  label: string,
  visibleForTurn: boolean,
  queued: string[],
): void {
  const build = ensureActivity(context, turnId);
  const turnKey = turnId || '__none__';
  if (!visibleForTurn && queued.length) {
    build.steps.push(...queued.map((pendingLabel) => ({
      label: pendingLabel,
      status: 'done' as const,
    })));
    context.pendingSteps.delete(turnKey);
  }
  build.status = 'running';
  context.updateLiveBuildStatus('running');
  const existing = build.steps.find(
    (step) => step.label === label && step.status === 'pending',
  );
  if (existing) existing.status = 'running';
  else build.steps.push({ label, status: 'running' });
  addFutureSteps(build, phase);
  context.scrollToLatest();
}

function handleStatus(context: BuildStateContext, event: Event): void {
  const data = parseSseEventData<{ phase?: unknown }>(event);
  if (!data) return;
  const phase = typeof data.phase === 'string' ? data.phase : null;
  finishLastStep(context);
  const turnId = getLiveTurnId(context);
  const turnKey = turnId || '__none__';
  if (handleTerminalPhase(context, phase, turnId, turnKey)) return;
  const label = buildPhaseToStep(phase);
  if (!label || !BUILD_DISPLAY_PHASES.has(phase || '')) return;
  const visibleForTurn = context.state.buildHistory.at(-1)?.turnId === turnId;
  const queued = context.pendingSteps.get(turnKey) || [];
  if (!visibleForTurn && !BUILD_SUBSTANTIVE_PHASES.has(phase || '')) {
    context.pendingSteps.set(turnKey, [...queued, label]);
    return;
  }
  showBuildPhase(context, turnId, phase || '', label, visibleForTurn, queued);
}

/** Coordinates live build snapshots and incremental build-status events. */
export function createBuildState(
  dependencies: BuildStateDependencies,
) {
  const context: BuildStateContext = {
    ...dependencies,
    pendingSteps: new Map<string, string[]>(),
    liveTurnId: undefined,
  };
  return {
    reset: () => {
      context.pendingSteps.clear();
      context.liveTurnId = undefined;
    },
    finishLastStep: () => finishLastStep(context),
    handleSnapshot: (event: Event) => handleSnapshot(context, event),
    handleStatus: (event: Event) => handleStatus(context, event),
  };
}
