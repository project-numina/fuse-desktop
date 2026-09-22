import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { AppContext } from '../../context';
import { readSnapshot } from '../../../services/lean/build/snapshot';
import {
  MODULE_NAME,
  PROJECT_ROUTE,
  bad,
  blueprintService,
  leanService,
  readJsonBody,
  str,
  stringList,
} from './helpers';

const STAMP_FILE = join('.lake', '.build-stamp.json');

interface SnapshotDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
}

export interface NormalizedBuild {
  status: 'succeeded' | 'failed' | 'unknown';
  message: string;
  exit_code: number | null;
  errors: SnapshotDiagnostic[];
  warnings: SnapshotDiagnostic[];
  unscoped_errors: string[];
  built_modules: string[];
}

/** Flatten the Lean service's persisted per-file diagnostic snapshot. */
export function readBuildSnapshot(projectRoot: string): SnapshotDiagnostic[] {
  const out: SnapshotDiagnostic[] = [];
  for (const [file, list] of Object.entries(readSnapshot(projectRoot))) {
    for (const item of list) {
      out.push({
        file: item.file || file,
        line: Number(item.line) || 0,
        column: Number(item.column) || 0,
        severity: item.severity || 'error',
        message: item.message,
      });
    }
  }
  return out;
}

function readStampOutcome(projectRoot: string): 'ok' | 'errors' | null {
  const path = join(projectRoot, STAMP_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { outcome?: unknown };
    return parsed.outcome === 'ok' || parsed.outcome === 'errors' ? parsed.outcome : null;
  } catch {
    return null;
  }
}

function diagnosticsFrom(value: unknown): SnapshotDiagnostic[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      file: str(item.file),
      line: Number(item.line) || 0,
      column: Number(item.column) || 0,
      severity: str(item.severity) || 'error',
      message: str(item.message),
    }));
}

function inferBuildStatus(
  record: Record<string, unknown>,
  output: Record<string, unknown>,
  outcomeStatus: string | null,
  exitCode: number | null,
  projectRoot: string,
  hasErrors: boolean,
): NormalizedBuild['status'] {
  if (outcomeStatus === 'up_to_date' && readStampOutcome(projectRoot) === 'errors') return 'failed';
  if (outcomeStatus !== null) return outcomeStatus === 'ok' || outcomeStatus === 'up_to_date' || outcomeStatus === 'succeeded' ? 'succeeded' : 'failed';
  if (typeof record.success === 'boolean') return record.success ? 'succeeded' : 'failed';
  if (typeof record.ok === 'boolean') return record.ok ? 'succeeded' : 'failed';
  if (typeof record.outcome === 'string') return record.outcome === 'ok' ? 'succeeded' : 'failed';
  if (typeof output.failed === 'boolean') return output.failed ? 'failed' : 'succeeded';
  if (exitCode !== null) return exitCode === 0 ? 'succeeded' : 'failed';
  const stamp = readStampOutcome(projectRoot);
  if (stamp) return stamp === 'ok' ? 'succeeded' : 'failed';
  return hasErrors ? 'failed' : 'unknown';
}

function buildMessage(input: {
  record: Record<string, unknown>;
  output: Record<string, unknown>;
  outcomeStatus: string | null;
  status: NormalizedBuild['status'];
  staleErrors: boolean;
  errors: SnapshotDiagnostic[];
  unscoped: string[];
  exitCode: number | null;
}): string {
  const { record, output, outcomeStatus, status, staleErrors, errors, unscoped, exitCode } = input;
  const explicit = str(output.message ?? record.message) || (typeof record.error === 'string' ? record.error : '');
  if (explicit) return explicit;
  if (staleErrors) {
    return errors.length > 0
      ? `Build up to date: nothing changed since the last build, which finished with ${errors.length} error(s)`
      : 'Build up to date: nothing changed since the last build, which failed without positional Lean diagnostics (likely a lakefile, manifest, or toolchain problem)';
  }
  if (outcomeStatus === 'up_to_date') return 'Build up to date';
  if (status === 'succeeded') return 'Build complete';
  if (unscoped.length > 0) return `Build failed: ${unscoped[0]}`;
  if (errors.length > 0) return `Build finished with ${errors.length} error(s)`;
  if (status === 'failed') return `Build failed${exitCode !== null ? ` (exit ${exitCode})` : ''}; no Lean diagnostics - likely a lakefile, manifest, or toolchain problem.`;
  return 'Build finished';
}

/** Normalize all supported Lean build return shapes and persisted fallbacks. */
export function normalizeBuildOutcome(outcome: unknown, projectRoot: string): NormalizedBuild {
  const record = outcome && typeof outcome === 'object' ? (outcome as Record<string, unknown>) : {};
  const output = record.output && typeof record.output === 'object' ? (record.output as Record<string, unknown>) : record;
  const diagnostics = diagnosticsFrom(output.diagnostics) ?? readBuildSnapshot(projectRoot);
  const errors = diagnostics.filter((item) => item.severity === 'error');
  const warnings = diagnostics.filter((item) => item.severity === 'warning');
  const unscoped = stringList(output.unscopedErrors ?? output.unscoped_errors);
  const exitCodeRaw = output.exitCode ?? output.exit_code;
  const exitCode = typeof exitCodeRaw === 'number' ? exitCodeRaw : null;
  const outcomeStatus = typeof outcome === 'string' ? outcome : typeof record.status === 'string' ? record.status : null;
  const staleErrors = outcomeStatus === 'up_to_date' && readStampOutcome(projectRoot) === 'errors';
  const status = inferBuildStatus(record, output, outcomeStatus, exitCode, projectRoot, errors.length > 0 || unscoped.length > 0);
  const message = buildMessage({ record, output, outcomeStatus, status, staleErrors, errors, unscoped, exitCode });
  return {
    status,
    message,
    exit_code: exitCode,
    errors,
    warnings,
    unscoped_errors: unscoped,
    built_modules: stringList(output.builtModules ?? output.built_modules),
  };
}

export function registerInternalBuildRoutes(app: Hono, ctx: AppContext): void {
  app.post(`${PROJECT_ROUTE}/build`, async (c) => {
    const project = blueprintService(ctx).openProject(c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const body = await readJsonBody(c);
    const target = typeof body.target === 'string' && body.target.trim() ? body.target.trim() : undefined;
    if (target && !MODULE_NAME.test(target)) throw bad(`Error: invalid module name '${target}'. Expected a dotted Lean module identifier (e.g. 'Numina.Blueprints.Froda').`);
    const outcome = await leanService(ctx).startBuild(project, { reason: 'agent', ...(target ? { target } : {}) });
    const normalized = normalizeBuildOutcome(outcome, project.projectRoot);
    if (target && normalized.status === 'succeeded' && !normalized.message.startsWith('Built ')) normalized.message = `Built ${target}`;
    return c.json({ ...normalized, target: target ?? null });
  });

  app.post(`${PROJECT_ROUTE}/build/status`, (c) => {
    const project = blueprintService(ctx).openProject(c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const service = leanService(ctx);
    const snapshot = service.buildSnapshot(project);
    const persisted = service.buildStatus(project);
    const counts = service.errorCounts(project);
    const steps = snapshot?.steps ?? [];
    const last = steps[steps.length - 1];
    const entries = Object.entries(counts);
    return c.json({
      status: snapshot?.status ?? (persisted.status === 'done' ? 'done' : 'not_built'),
      running: snapshot?.status === 'running',
      phase: last?.phase ?? null,
      message: last?.message ?? null,
      steps,
      persisted: { ...persisted, outcome: readStampOutcome(project.projectRoot) },
      error_count: entries.reduce((sum, [, value]) => sum + value.errors, 0),
      warning_count: entries.reduce((sum, [, value]) => sum + value.warnings, 0),
      files_with_errors: entries.filter(([, value]) => value.errors > 0).map(([file, value]) => ({ file, errors: value.errors, warnings: value.warnings })),
    });
  });

  app.post(`${PROJECT_ROUTE}/build/errors`, (c) => {
    const project = blueprintService(ctx).openProject(c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const diagnostics = readBuildSnapshot(project.projectRoot);
    return c.json({
      errors: diagnostics.filter((item) => item.severity === 'error'),
      warnings: diagnostics.filter((item) => item.severity === 'warning'),
    });
  });
}
