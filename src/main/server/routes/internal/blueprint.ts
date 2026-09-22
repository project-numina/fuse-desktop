import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { BlueprintResponse } from '@shared/api-types';
import type { AppContext } from '../../context';
import type { OpenProject } from '../../../services/types';
import type { BlueprintServiceLike, InternalPorts } from '.';
import {
  ALL_DECLARATION_FIELDS,
  DEFAULT_DECLARATION_FIELDS,
  PROJECT_ROUTE,
  bad,
  blueprintService,
  findRow,
  normalizeSourceFilter,
  projectDeclaration,
  readJsonBody,
  rowStatus,
  str,
  stringList,
  validateDeclarationFields,
  validateLabel,
} from './helpers';

const ROLLUP_STATUSES = ['not_started', 'in_progress', 'proved'] as const;
const STATUS_FILTERS: Readonly<Record<string, string>> = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  proved: 'proved',
  formalized: 'in_progress',
  unformalized: 'not_started',
};
const STATUS_DISPATCH: Readonly<Record<string, { stored: string; requiresLean: boolean }>> = {
  proved: { stored: 'proved', requiresLean: true },
  formalized: { stored: 'in_progress', requiresLean: true },
  unformalized: { stored: 'not_started', requiresLean: false },
};
const PROOF_REQUIRED_KINDS: ReadonlySet<string> = new Set(['theorem', 'lemma', 'corollary', 'proposition', 'example', 'claim']);

function openProject(ctx: AppContext, owner: string, repo: string, blueprint: string): OpenProject {
  return blueprintService(ctx).openProject(owner, repo, blueprint);
}

function declarationFileRollup(detail: BlueprintResponse, rows: Record<string, unknown>[]) {
  const includedFiles = stringList(detail.included_files);
  const titles = detail.chapter_titles && typeof detail.chapter_titles === 'object' ? detail.chapter_titles : {};
  const perFile = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const file = str(row.sourceFile);
    const statuses = perFile.get(file) ?? {};
    const status = rowStatus(row);
    statuses[status] = (statuses[status] ?? 0) + 1;
    perFile.set(file, statuses);
  }
  const ordered = [...new Set(includedFiles)];
  ordered.push(...[...perFile.keys()].filter((path) => !includedFiles.includes(path)).sort());
  const totals: Record<string, number> = Object.fromEntries(ROLLUP_STATUSES.map((status) => [status, 0]));
  const files = ordered.map((path) => {
    const statuses = perFile.get(path) ?? {};
    for (const [status, total] of Object.entries(statuses)) totals[status] = (totals[status] ?? 0) + total;
    return {
      file: path,
      title: str((titles as Record<string, unknown>)[path]),
      count: Object.values(statuses).reduce((sum, value) => sum + value, 0),
      status: { ...Object.fromEntries(ROLLUP_STATUSES.map((status) => [status, 0])), ...statuses },
    };
  });
  return { includedFiles, totals, files };
}

function summaryPayload(project: OpenProject, detail: BlueprintResponse, rows: Record<string, unknown>[]): Record<string, unknown> {
  const { includedFiles, totals, files } = declarationFileRollup(detail, rows);
  return {
    name: project.blueprint.id,
    title: project.blueprint.title,
    description: project.blueprint.description,
    area: project.blueprint.area,
    source_type: project.blueprint.source_type,
    repository_root: project.clonePath,
    project_root: project.projectRoot,
    project_subdir: project.projectSubdir,
    blueprint_file: project.blueprintFile ?? (str(detail.blueprint_file) || null),
    included_files: includedFiles,
    lean_files: stringList(detail.lean_files),
    declaration_count: Object.values(totals).reduce((sum, value) => sum + value, 0),
    status_counts: totals,
    files,
  };
}

async function applyDeclarationUpdates(
  service: BlueprintServiceLike,
  project: OpenProject,
  updates: Record<string, unknown>[],
): Promise<{ updated: string[]; skipped: string[] }> {
  const known = new Set((await service.listDeclarations(project)).map((row) => str(row.label)));
  const updated: string[] = [];
  const skipped: string[] = [];
  for (const raw of updates) {
    const label = raw.label;
    if (typeof label !== 'string') {
      skipped.push(`${JSON.stringify(raw)} (each update needs a 'label' string)`);
      continue;
    }
    const labelError = validateLabel(label);
    const fields = raw.fields ?? {};
    const fieldError = validateDeclarationFields(fields);
    if (labelError || fieldError || !known.has(label)) {
      skipped.push(`${label} (${labelError ?? fieldError ?? 'not found; has it been parsed yet?'})`);
      continue;
    }
    try {
      if (await service.updateDeclaration(project, label, fields as Record<string, unknown>)) updated.push(label);
      else skipped.push(`${label} (not found; has it been parsed yet?)`);
    } catch (error) {
      skipped.push(`${label} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { updated, skipped };
}

interface StatusPlan {
  skipped: string[];
  resolutions: string[];
  normalized: string[];
  pending: Array<{ label: string; verb: string }>;
}

/** Resolve labels once, deduplicate aliases, and apply statement-only normalization. */
function planStatusUpdates(rows: Record<string, unknown>[], labels: string[], verb: string, requiresLean: boolean): StatusPlan {
  const plan: StatusPlan = { skipped: [], resolutions: [], normalized: [], pending: [] };
  const seen = new Set<string>();
  for (const requested of [...new Set(labels)]) {
    const found = findRow(rows, requested);
    if (!found) {
      plan.skipped.push(`${requested} (no declaration with this label or Lean name; pass the blueprint \\label value, e.g. 'lem:...')`);
      continue;
    }
    const label = str(found.row.label);
    if (found.resolved) plan.resolutions.push(`'${requested}' -> '${label}'`);
    if (seen.has(label)) continue;
    seen.add(label);
    if (requiresLean && !str(found.row.leanDeclaration)) {
      plan.skipped.push(`${label} (no leanDeclaration; run formalizer)`);
      continue;
    }
    const kind = str(found.row.kind).toLowerCase();
    const normalize = verb === 'formalized' && found.row.proof == null && !PROOF_REQUIRED_KINDS.has(kind);
    if (normalize) plan.normalized.push(label);
    plan.pending.push({ label, verb: normalize ? 'proved' : verb });
  }
  return plan;
}

async function applyStatusPlan(service: BlueprintServiceLike, project: OpenProject, plan: StatusPlan): Promise<{ updated: string[]; rewritten: string[] }> {
  const updated: string[] = [];
  const rewritten = new Set<string>();
  for (const item of plan.pending) {
    try {
      const result = await service.setDeclarationStatus(project, item.label, item.verb);
      if (!result.ok) {
        const reason = result.reason?.trim();
        if (!reason) plan.skipped.push(`${item.label} (label not found in the blueprint .tex; run blueprint_refresh or check the source)`);
        else plan.skipped.push(reason.startsWith(item.label) ? reason : `${item.label} (${reason})`);
        continue;
      }
      updated.push(item.label);
      for (const file of result.rewritten ?? []) rewritten.add(file);
    } catch (error) {
      plan.skipped.push(`${item.label} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { updated, rewritten: [...rewritten] };
}

export function registerInternalBlueprintRoutes(app: Hono, ctx: AppContext, validate: InternalPorts['validateBlueprintGraph']): void {
  app.post(`${PROJECT_ROUTE}/blueprint/summary`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const service = blueprintService(ctx);
    const [detail, rows] = await Promise.all([service.getBlueprint(project), service.listDeclarations(project)]);
    return c.json(summaryPayload(project, detail, rows));
  });

  app.post(`${PROJECT_ROUTE}/blueprint/declarations/list`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const body = await readJsonBody(c);
    const file = typeof body.file === 'string' ? body.file : null;
    const status = typeof body.status === 'string' ? body.status : null;
    const kind = typeof body.kind === 'string' ? body.kind : null;
    const storedStatus = status === null ? null : (STATUS_FILTERS[status] ?? null);
    if (status !== null && storedStatus === null) throw bad(`Error: invalid status filter '${status}'. Expected one of ${JSON.stringify(Object.keys(STATUS_FILTERS).sort())}.`);
    const rows = await blueprintService(ctx).listDeclarations(project);
    const fileCandidates = file === null ? null : normalizeSourceFilter(project, file);
    const matches = rows.filter((row) => (!fileCandidates || fileCandidates.has(str(row.sourceFile))) && (storedStatus === null || rowStatus(row) === storedStatus) && (kind === null || str(row.kind) === kind));
    const payload: Record<string, unknown> = {
      filters: { file, status, kind },
      count: matches.length,
      declarations: matches.map((row) => ({ label: str(row.label), kind: str(row.kind), title: str(row.title), status: rowStatus(row), file: str(row.sourceFile) })),
    };
    if (matches.length === 0) payload.available = {
      files: [...new Set(rows.map((row) => str(row.sourceFile)))],
      statuses: [...new Set(rows.map(rowStatus))].sort(),
      kinds: [...new Set(rows.map((row) => str(row.kind)))].sort(),
    };
    return c.json(payload);
  });

  app.post(`${PROJECT_ROUTE}/blueprint/declarations/read`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const body = await readJsonBody(c);
    const labels = typeof body.labels === 'string' ? [body.labels] : stringList(body.labels);
    if (labels.length === 0) throw bad("Error: 'labels' must be a label string or a list of label strings.");
    for (const label of labels) {
      const error = validateLabel(label);
      if (error) throw bad(error);
    }
    const wanted = Array.isArray(body.fields) ? stringList(body.fields) : null;
    const requested = wanted ? wanted.filter((name) => ALL_DECLARATION_FIELDS.has(name)) : DEFAULT_DECLARATION_FIELDS;
    const ignored = wanted?.filter((name) => !ALL_DECLARATION_FIELDS.has(name)) ?? [];
    const rows = await blueprintService(ctx).listDeclarations(project);
    const declarations: Record<string, unknown> = {};
    const notFound: string[] = [];
    for (const label of [...new Set(labels)]) {
      const found = findRow(rows, label);
      if (found) declarations[label] = projectDeclaration(found.row, requested);
      else notFound.push(label);
    }
    return c.json({ declarations, not_found: notFound, ...(ignored.length > 0 ? { ignored_fields: ignored } : {}) });
  });

  app.post(`${PROJECT_ROUTE}/blueprint/declarations/update`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const updates = (await readJsonBody(c)).updates;
    if (!Array.isArray(updates) || updates.length === 0 || !updates.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      throw bad("Error: 'updates' must be a non-empty list of {'label': str, 'fields': object} objects.");
    }
    const result = await applyDeclarationUpdates(blueprintService(ctx), project, updates as Record<string, unknown>[]);
    return c.json({ blueprint: project.blueprint.id, ...result });
  });

  app.post(`${PROJECT_ROUTE}/blueprint/declarations/status`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const body = await readJsonBody(c);
    const verb = str(body.status);
    const dispatch = STATUS_DISPATCH[verb];
    if (!dispatch) throw bad(`Error: invalid status '${verb}'. Expected one of ${JSON.stringify(Object.keys(STATUS_DISPATCH).sort())}.`);
    const labels = typeof body.labels === 'string' ? [body.labels] : stringList(body.labels);
    if (labels.length === 0) throw bad("Error: 'labels' must contain at least one declaration label.");
    for (const label of labels) {
      const error = validateLabel(label);
      if (error) throw bad(error);
    }
    const service = blueprintService(ctx);
    const plan = planStatusUpdates(await service.listDeclarations(project), labels, verb, dispatch.requiresLean);
    const { updated, rewritten } = await applyStatusPlan(service, project, plan);
    return c.json({
      blueprint: project.blueprint.id,
      target_status: dispatch.stored,
      updated,
      normalized: plan.normalized.filter((label) => updated.includes(label)),
      resolutions: plan.resolutions,
      skipped: plan.skipped,
      rewritten_files: rewritten,
    });
  });

  app.post(`${PROJECT_ROUTE}/blueprint/validate`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const entrypoint = project.blueprintFile;
    if (!entrypoint) throw bad('Error: this blueprint has no .tex entrypoint yet; there is nothing to validate.');
    if (!existsSync(join(project.clonePath, entrypoint))) throw bad(`Error: blueprint source '${entrypoint}' does not exist; there is nothing to validate yet.`);
    const result = await validate(project.clonePath, entrypoint);
    const issues = result.issues.map((issue) => ({
      code: issue.code,
      file: issue.file,
      line: issue.line,
      severity: issue.severity,
      message: issue.message,
      location: `${issue.file}:${issue.line}`,
    }));
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    const declarationCount = result.declarationCount ?? result.declaration_count ?? 0;
    const filesChecked = result.filesChecked ?? result.files_checked ?? [];
    return c.json({
      ok: errorCount === 0,
      summary: `Checked ${declarationCount} declarations across ${filesChecked.length} TeX files; found ${errorCount} errors and ${warningCount} warnings.`,
      checks: { latex_structure: 'skipped', dependency_graph: errorCount === 0 ? 'passed' : 'failed' },
      issues,
    });
  });

  app.post(`${PROJECT_ROUTE}/blueprint/refresh`, async (c) => {
    const project = openProject(ctx, c.req.param('owner'), c.req.param('repo'), c.req.param('blueprint'));
    const service = blueprintService(ctx);
    await service.refresh(project);
    const rows = await service.listDeclarations(project);
    return c.json({
      blueprint: project.blueprint.id,
      declarations: rows.map((row) => ({ label: str(row.label), kind: str(row.kind), title: str(row.title) })),
    });
  });
}
