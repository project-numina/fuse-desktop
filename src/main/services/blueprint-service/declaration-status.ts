import { readFileSync } from 'node:fs';
import { HttpError } from '../../server/errors';
import {
  applyDeclarationStatusPlan,
  declarationStatusSummary,
  defaultBlueprintFileForProject,
  listDeclarations,
  planDeclarationStatusUpdates,
  STATUS_TARGETS,
  type BlueprintModel,
} from '../blueprint';
import { contentHash } from '../blueprint-watcher';
import type { OpenProject } from '../types';
import { absolutePathIn, isFile } from './projects';

export interface DeclarationStatusResult {
  ok: boolean;
  rewritten: string[];
  reason?: string;
  summary: string;
}

export interface DeclarationStatusMutation {
  result: DeclarationStatusResult;
  rewrittenContent: Map<string, Buffer | null>;
  persist: boolean;
}

function statusTarget(status: string): [stored: string, requireFormalizationData: boolean] {
  const target = STATUS_TARGETS[status];
  if (target) return target;
  if (status === 'proved') return ['proved', true];
  if (status === 'in_progress') return ['in_progress', true];
  if (status === 'not_started') return ['not_started', false];
  throw new HttpError(400, `Invalid status '${status}'. Use proved, formalized or unformalized.`, 'http_400');
}

export function validateDeclarationStatus(status: string): void {
  statusTarget(status);
}

export function missingBlueprintSourceResult(project: OpenProject): DeclarationStatusResult | null {
  const entrypoint = project.blueprintFile;
  if (entrypoint && isFile(absolutePathIn(project.clonePath, entrypoint))) return null;
  const reason = `blueprint .tex not found at ${entrypoint ?? defaultBlueprintFileForProject(project.projectSubdir)}`;
  return { ok: false, rewritten: [], reason, summary: `Error: ${reason}` };
}

function hashFile(project: OpenProject, relative: string): string | null {
  try {
    return contentHash(readFileSync(absolutePathIn(project.clonePath, relative)));
  } catch {
    return null;
  }
}

/** Rewrite source tags first and describe the model persistence still required. */
export function mutateDeclarationStatus(
  project: OpenProject,
  model: BlueprintModel,
  label: string,
  status: string,
  captureRewrittenContent = true,
): DeclarationStatusMutation {
  const [target, requireFormalizationData] = statusTarget(status);
  const missingSource = missingBlueprintSourceResult(project);
  if (missingSource) return { result: missingSource, rewrittenContent: new Map(), persist: false };
  const entrypoint = project.blueprintFile!;
  const plan = planDeclarationStatusUpdates(listDeclarations(model), [label], target, requireFormalizationData);
  if (Object.keys(plan.pending).length === 0) {
    const result = { ok: false, rewritten: [], reason: plan.failures[0], summary: declarationStatusSummary(plan, [], status) };
    return { result, rewrittenContent: new Map(), persist: false };
  }
  const candidates = new Set<string>(
    [...model.includedFiles, ...Object.values(plan.sources), ...Object.values(plan.proofSources)].filter(Boolean),
  );
  const before = new Map<string, string | null>();
  for (const relative of candidates) before.set(relative, hashFile(project, relative));
  const successes = applyDeclarationStatusPlan(model, project.clonePath, absolutePathIn(project.clonePath, entrypoint), plan);
  const rewrittenContent = changedFiles(project, candidates, before, captureRewrittenContent);
  const rewritten = [...rewrittenContent.keys()];
  const summary = declarationStatusSummary(plan, successes, status);
  if (successes.length === 0) {
    return { result: { ok: false, rewritten, reason: plan.failures[0], summary }, rewrittenContent, persist: false };
  }
  return { result: { ok: true, rewritten, summary }, rewrittenContent, persist: true };
}

function changedFiles(
  project: OpenProject,
  candidates: Set<string>,
  before: Map<string, string | null>,
  captureContent: boolean,
): Map<string, Buffer | null> {
  const changed = new Map<string, Buffer | null>();
  for (const relative of candidates) {
    const after = hashFile(project, relative);
    if (after === before.get(relative)) continue;
    changed.set(relative, after === null || !captureContent ? null : readFileSync(absolutePathIn(project.clonePath, relative)));
  }
  return changed;
}
