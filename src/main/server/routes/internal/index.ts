/**
 * MCP-only internal HTTP routes.
 *
 * The public factory remains here so application registration and callers do
 * not depend on the endpoint grouping used by the implementation.
 */

import { Hono } from 'hono';
import type {
  BlueprintBuildStatus,
  BlueprintResponse,
  BuildErrorCounts,
  BuildSnapshotEvent,
  DiagnosticRequest,
  DiagnosticResponse,
  GoalRequest,
  GoalResponse,
} from '@shared/api-types';
import type { AppContext } from '../../context';
import type { OpenProject } from '../../../services/types';
import { registerInternalBlueprintRoutes } from './blueprint';
import { registerInternalBuildRoutes } from './build';
import { registerInternalLeanRoutes } from './lean';

export { normalizeBuildOutcome, readBuildSnapshot } from './build';
export {
  ALLOWED_DECLARATION_FIELDS,
  ALL_DECLARATION_FIELDS,
  DECLARATION_ASSESSMENTS,
  DEFAULT_DECLARATION_FIELDS,
  MODULE_NAME,
  VALID_LABEL,
  resolveDeclarationByLeanName,
  validateDeclarationFields,
  validateLabel,
} from './helpers';
export { loogleRemote } from './lean';

export interface BlueprintServiceLike {
  openProject(owner: string, repo: string, blueprintId: string): OpenProject;
  getBlueprint(project: OpenProject): Promise<BlueprintResponse>;
  refresh(project: OpenProject): Promise<void>;
  listDeclarations(project: OpenProject): Promise<Record<string, unknown>[]>;
  updateDeclaration(project: OpenProject, label: string, fields: Record<string, unknown>): Promise<boolean>;
  setDeclarationStatus(project: OpenProject, label: string, status: string): Promise<{ ok: boolean; rewritten: string[]; reason?: string }>;
}

export interface ScopedDiagnosticRequest extends DiagnosticRequest {
  declaration_name?: string | null;
}

export interface DiagnosticResponseLike extends DiagnosticResponse {
  success?: boolean;
}

export interface TermGoalResponse {
  line_context: string | null;
  expected_type: string | null;
}

export interface LeanServiceLike {
  buildStatus(project: OpenProject): BlueprintBuildStatus;
  buildSnapshot(project: OpenProject): BuildSnapshotEvent | null;
  errorCounts(project: OpenProject): BuildErrorCounts;
  startBuild(project: OpenProject, opts?: { reason?: string; target?: string }): Promise<unknown>;
  loogle?(query: string, numResults?: number): Promise<unknown>;
  goals?(project: OpenProject, req: GoalRequest, signal?: AbortSignal): Promise<GoalResponse>;
  termGoal?(project: OpenProject, req: GoalRequest, signal?: AbortSignal): Promise<TermGoalResponse>;
  diagnostics?(project: OpenProject, req: ScopedDiagnosticRequest, signal?: AbortSignal): Promise<DiagnosticResponseLike>;
}

interface ValidationIssueLike {
  code: string;
  file: string;
  line: number;
  severity: string;
  message: string;
}

export interface ValidationResultLike {
  issues: readonly ValidationIssueLike[];
  declarationCount?: number;
  declaration_count?: number;
  filesChecked?: readonly string[];
  files_checked?: readonly string[];
}

/** Injectable network and validation boundaries used by route tests. */
export interface InternalPorts {
  validateBlueprintGraph(projectRoot: string, entrypoint: string): ValidationResultLike | Promise<ValidationResultLike>;
  fetch: typeof fetch;
}

async function defaultValidate(projectRoot: string, entrypoint: string): Promise<ValidationResultLike> {
  // Resolve at call time so application startup does not depend on the pure
  // LaTeX validation modules being initialized first.
  const mod = (await import('@main/services/blueprint/latex/validation')) as {
    validateBlueprintGraph: InternalPorts['validateBlueprintGraph'];
  };
  return mod.validateBlueprintGraph(projectRoot, entrypoint);
}

export function internalRoutes(ctx: AppContext, ports: Partial<InternalPorts> = {}): Hono {
  const app = new Hono();
  registerInternalBlueprintRoutes(app, ctx, ports.validateBlueprintGraph ?? defaultValidate);
  registerInternalBuildRoutes(app, ctx);
  registerInternalLeanRoutes(app, ctx, ports.fetch ?? globalThis.fetch);
  return app;
}
