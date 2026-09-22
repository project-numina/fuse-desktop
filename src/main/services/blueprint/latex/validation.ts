/**
 * Validate dependency graphs from canonical leanblueprint sources.
 *
 * Checks cover labels, dependency targets and cycles within a bounded,
 * contained include closure. Lean declaration existence remains the Lean
 * resolver's job.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprintDeclarations, type BlueprintDeclaration } from './blueprint';
import {
  collectIncludedFiles,
  readUtf8,
  resolvePathLoose,
  resolveProjectPath,
  toPosixPath,
} from './project';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationLimits {
  maxSourceFiles: number;
  maxSourceFileBytes: number;
  maxTotalSourceBytes: number;
  maxInputReferences: number;
  maxValidationIssues: number;
}

export const DEFAULT_VALIDATION_LIMITS: Readonly<ValidationLimits> = {
  maxSourceFiles: 512,
  maxSourceFileBytes: 4 * 1024 * 1024,
  maxTotalSourceBytes: 32 * 1024 * 1024,
  maxInputReferences: 4096,
  maxValidationIssues: 200,
};

export const MAX_VALIDATION_ISSUES = DEFAULT_VALIDATION_LIMITS.maxValidationIssues;

/** One structured, source-anchored validation finding. */
export interface BlueprintValidationIssue {
  /** Stable machine-readable category. */
  code: string;
  /** Repository-relative source path. */
  file: string;
  /** One-based source line. */
  line: number;
  severity: ValidationSeverity;
  message: string;
}

/** Structured result of one static dependency-graph validation. */
export interface BlueprintValidationResult {
  /** Bounded findings in deterministic order. */
  issues: BlueprintValidationIssue[];
  /** Number of canonically parsed declarations. */
  declarationCount: number;
  /** Readable files visited from the entrypoint include closure. */
  filesChecked: string[];
}

export interface BlueprintSourceFile {
  path: string;
  text: string;
}

/** One include directive observed while loading a source closure. */
export interface BlueprintInputReference {
  file: string;
  line: number;
  rawTarget: string;
  targetFile: string | null;
  targetExists: boolean;
}

/** A contained, bounded include closure shared by lint and graph checks. */
export interface BlueprintSourceClosure {
  /** The resolved project root. */
  projectRoot: string;
  entrypoint: string;
  files: BlueprintSourceFile[];
  inputs: BlueprintInputReference[];
  issues: BlueprintValidationIssue[];
}

export function formatValidationSummary(
  declarationCount: number,
  fileCount: number,
  errorCount: number,
  warningCount: number,
): string {
  return `Checked ${declarationCount} declarations across ${fileCount} TeX files; found ${errorCount} errors and ${warningCount} warnings.`;
}

/** Format one editor-friendly diagnostic line. */
export function renderValidationIssue(issue: BlueprintValidationIssue): string {
  return `${issue.file}:${issue.line}: ${issue.severity}: ${issue.message}`;
}

export function validationErrors(result: BlueprintValidationResult): BlueprintValidationIssue[] {
  return result.issues.filter((issue) => issue.severity === 'error');
}

export function validationWarnings(result: BlueprintValidationResult): BlueprintValidationIssue[] {
  return result.issues.filter((issue) => issue.severity === 'warning');
}

/** Whether the graph has no validation errors. */
export function validationOk(result: BlueprintValidationResult): boolean {
  return validationErrors(result).length === 0;
}

export function validationSummary(result: BlueprintValidationResult): string {
  return formatValidationSummary(
    result.declarationCount,
    result.filesChecked.length,
    validationErrors(result).length,
    validationWarnings(result).length,
  );
}

/** Keeps reports bounded even for adversarial dependency lists. */
class IssueCollector {
  readonly issues: BlueprintValidationIssue[] = [];
  omitted = 0;

  constructor(private readonly maxIssues: number) {}

  add(code: string, file: string, line: number, severity: ValidationSeverity, message: string): void {
    if (this.issues.length < this.maxIssues - 1) this.issues.push({ code, file, line, severity, message });
    else this.omitted += 1;
  }

  /** Append one truncation warning when findings exceeded the cap. */
  finish(entrypoint: string): BlueprintValidationIssue[] {
    if (this.omitted) {
      this.issues.push({
        code: 'issues_truncated',
        file: entrypoint,
        line: 1,
        severity: 'warning',
        message: `${this.omitted} additional findings were omitted.`,
      });
    }
    return this.issues;
  }
}

/** Apply the canonical issue cap and truncation message to combined checks. */
export function boundValidationIssues(
  issues: Iterable<BlueprintValidationIssue>,
  entrypoint: string,
  maxIssues = DEFAULT_VALIDATION_LIMITS.maxValidationIssues,
): BlueprintValidationIssue[] {
  const collector = new IssueCollector(maxIssues);
  for (const issue of issues) collector.add(issue.code, issue.file, issue.line, issue.severity, issue.message);
  return collector.finish(entrypoint);
}

function displayPath(root: string, filePath: string): string {
  const resolved = resolvePathLoose(filePath);
  if (resolved === null) return path.basename(filePath);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return toPosixPath(relative);
}

/** Read a contained include closure within file and byte budgets, recording why a file could not be loaded. */
class BoundedSourceReader {
  private readonly cache = new Map<string, string | null>();
  private totalBytes = 0;
  private fileLimitReported = false;

  constructor(
    private readonly projectRoot: string,
    private readonly issues: BlueprintValidationIssue[],
    private readonly limits: ValidationLimits,
  ) {}

  private add(code: string, filePath: string, message: string): void {
    this.issues.push({ code, file: displayPath(this.projectRoot, filePath), line: 1, severity: 'error', message });
  }

  read = (filePath: string): string | null => {
    const resolved = resolvePathLoose(filePath) ?? filePath;
    const cached = this.cache.get(resolved);
    if (cached !== undefined) return cached;
    if (this.cache.size >= this.limits.maxSourceFiles) {
      if (!this.fileLimitReported) {
        this.add('source_file_limit', filePath, `blueprint include closure exceeds ${this.limits.maxSourceFiles} files.`);
        this.fileLimitReported = true;
      }
      return null;
    }
    let size: number;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      this.add('source_unreadable', filePath, 'included TeX source is missing or unreadable.');
      this.cache.set(resolved, null);
      return null;
    }
    if (size > this.limits.maxSourceFileBytes) {
      this.add('source_file_too_large', filePath, 'TeX source exceeds the 4 MiB per-file validation limit.');
      this.cache.set(resolved, null);
      return null;
    }
    if (this.totalBytes + size > this.limits.maxTotalSourceBytes) {
      this.add('source_total_too_large', filePath, 'TeX include closure exceeds the 32 MiB validation limit.');
      this.cache.set(resolved, null);
      return null;
    }
    const source = readUtf8(filePath);
    if (source === null) {
      this.add('source_unreadable', filePath, 'included TeX source is not readable UTF-8 text.');
      this.cache.set(resolved, null);
      return null;
    }
    this.totalBytes += size;
    this.cache.set(resolved, source);
    return source;
  };
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Load one contained include closure once for all static validators. */
export function loadBlueprintSourceClosure(
  projectRoot: string,
  entrypoint: string,
  limits: Partial<ValidationLimits> = {},
): BlueprintSourceClosure {
  const effective = { ...DEFAULT_VALIDATION_LIMITS, ...limits };
  const root = resolvePathLoose(projectRoot) ?? projectRoot;
  const entryFile = resolveProjectPath(root, entrypoint);
  if (entryFile === null) {
    const issue: BlueprintValidationIssue = {
      code: 'unsafe_entrypoint',
      file: entrypoint,
      line: 1,
      severity: 'error',
      message: 'blueprint entrypoint must stay inside the repository.',
    };
    return { projectRoot: root, entrypoint, files: [], inputs: [], issues: [issue] };
  }
  if (!isFile(entryFile)) {
    const issue: BlueprintValidationIssue = {
      code: 'source_not_found',
      file: entrypoint,
      line: 1,
      severity: 'error',
      message: 'blueprint entrypoint file not found.',
    };
    return { projectRoot: root, entrypoint, files: [], inputs: [], issues: [issue] };
  }

  const sourceIssues: BlueprintValidationIssue[] = [];
  const reader = new BoundedSourceReader(root, sourceIssues, effective);
  const inputs: BlueprintInputReference[] = [];
  let inputLimitReported = false;

  const observeInput = (current: string, lineNumber: number, rawTarget: string, target: string | null): void => {
    if (inputs.length >= effective.maxInputReferences) {
      if (!inputLimitReported) {
        sourceIssues.push({
          code: 'source_input_limit',
          file: displayPath(root, current),
          line: lineNumber,
          severity: 'error',
          message: `blueprint include closure contains more than ${effective.maxInputReferences} input directives.`,
        });
        inputLimitReported = true;
      }
      return;
    }
    inputs.push({
      file: displayPath(root, current),
      line: lineNumber,
      rawTarget,
      targetFile: target !== null ? displayPath(root, target) : null,
      targetExists: target !== null && isFile(target),
    });
  };

  const files = collectIncludedFiles(entryFile, root, {
    reader: reader.read,
    inputSearchRoots: [path.dirname(entryFile)],
    onInput: observeInput,
  });
  const sources: BlueprintSourceFile[] = [];
  for (const relativePath of files) {
    const source = reader.read(path.join(root, relativePath));
    if (source !== null) sources.push({ path: relativePath, text: source });
  }
  return { projectRoot: root, entrypoint, files: sources, inputs, issues: sourceIssues };
}

interface DeclarationSite {
  declaration: BlueprintDeclaration;
  file: string;
}

/** Graph SCCs by an iterative Tarjan traversal; roots and successors in sorted order for determinism. */
function stronglyConnectedComponents(edges: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;
  const sortedSuccessors = (node: string): string[] => [...(edges.get(node) ?? [])].sort();

  for (const root of [...edges.keys()].sort()) {
    if (index.has(root)) continue;
    index.set(root, counter);
    lowlink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);
    const work: Array<[string, string[], number]> = [[root, sortedSuccessors(root), 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, successors] = frame;
      if (frame[2] >= successors.length) {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(node)!));
        }
        if (lowlink.get(node) === index.get(node)) {
          const component: string[] = [];
          for (;;) {
            const member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
            if (member === node) break;
          }
          components.push(component);
        }
        continue;
      }
      const successor = successors[frame[2]];
      frame[2] += 1;
      if (!index.has(successor)) {
        index.set(successor, counter);
        lowlink.set(successor, counter);
        counter += 1;
        stack.push(successor);
        onStack.add(successor);
        work.push([successor, sortedSuccessors(successor), 0]);
      } else if (onStack.has(successor)) {
        lowlink.set(node, Math.min(lowlink.get(node)!, index.get(successor)!));
      }
    }
  }
  return components;
}

/** Report duplicate, dangling and cyclic declaration dependencies. */
function checkGraph(sites: readonly DeclarationSite[], issues: IssueCollector): void {
  const firstByLabel = new Map<string, DeclarationSite>();
  for (const site of sites) {
    const label = site.declaration.label.trim();
    if (!label) {
      issues.add('empty_label', site.file, site.declaration.sourceLine, 'error', 'declaration has an empty \\label.');
      continue;
    }
    const first = firstByLabel.get(label);
    if (first) {
      issues.add(
        'duplicate_label',
        site.file,
        site.declaration.sourceLine,
        'error',
        `duplicate \\label{${label}}; first defined at ${first.file}:${first.declaration.sourceLine}.`,
      );
      continue;
    }
    firstByLabel.set(label, site);
  }

  const edges = new Map<string, Set<string>>();
  for (const label of firstByLabel.keys()) edges.set(label, new Set());
  for (const [label, site] of firstByLabel) {
    for (const dependency of site.declaration.uses) {
      if (!firstByLabel.has(dependency)) {
        issues.add(
          'unknown_dependency',
          site.file,
          site.declaration.sourceLine,
          'error',
          `\\uses{${dependency}} references an unknown label.`,
        );
        continue;
      }
      edges.get(label)!.add(dependency);
    }
  }

  for (const component of stronglyConnectedComponents(edges)) {
    const isCycle = component.length > 1 || edges.get(component[0])!.has(component[0]);
    if (!isCycle) continue;
    const members = [...component].sort();
    const site = firstByLabel.get(members[0])!;
    issues.add(
      'dependency_cycle',
      site.file,
      site.declaration.sourceLine,
      'error',
      'dependency cycle between: ' + members.join(', ') + '.',
    );
  }
}

/** Validate labels and `\uses` edges in an included blueprint project. */
export function validateBlueprintGraph(
  projectRoot: string,
  entrypoint: string,
  closure?: BlueprintSourceClosure,
  limits: Partial<ValidationLimits> = {},
): BlueprintValidationResult {
  const effective = { ...DEFAULT_VALIDATION_LIMITS, ...limits };
  const root = resolvePathLoose(projectRoot) ?? projectRoot;
  const sourceClosure = closure ?? loadBlueprintSourceClosure(root, entrypoint, effective);
  if (sourceClosure.projectRoot !== root || sourceClosure.entrypoint !== entrypoint) {
    throw new Error('source closure does not match the requested blueprint');
  }
  const issues = new IssueCollector(effective.maxValidationIssues);
  for (const issue of sourceClosure.issues) issues.add(issue.code, issue.file, issue.line, issue.severity, issue.message);

  const sites: DeclarationSite[] = [];
  for (const sourceFile of sourceClosure.files) {
    for (const declaration of parseBlueprintDeclarations(sourceFile.text)) sites.push({ declaration, file: sourceFile.path });
  }
  checkGraph(sites, issues);
  return {
    issues: issues.finish(entrypoint),
    declarationCount: sites.length,
    filesChecked: sourceClosure.files.map((file) => file.path),
  };
}
