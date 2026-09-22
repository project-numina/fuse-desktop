/**
 * Everything Fuse writes into a repository folder from a template: the
 * starter leanblueprint entrypoint, the LaTeX compile-check scaffold, and
 * the minimal Lean project the "New project" flow sets up. Template text is
 * verbatim from the web backend.
 */

import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { BlueprintSourceFileResponse, RepositorySetupResult } from '@shared/api-types';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../store/registry';
import { currentBranch, isGitRepository, requireNoUnresolvedMerge, withRepositoryLock } from '../git';
import type { OpenProject } from '../types';
import { blueprintService } from './contracts';
import {
  defaultBlueprintFileForProject,
  validateLeanToolchain,
  validateLeanVersion,
  validateMathlibRevision,
  validateModuleName,
  validateProjectSubdir,
} from './ids';
import { pathResolvesUnder } from './repo-files';

// ── Starter blueprint ─────────────────────────────────────────────────────

// The entrypoint is a table of contents: it holds only ``\input{chapters/...}``
// lines and no declarations of its own. The starter ships one example chapter so
// the two-file structure (TOC entrypoint + per-topic chapter files) is concrete
// from the start; the draft step and the author agent extend it the same way.
export const STARTER_CHAPTER_NAME = 'example_chapter';
export const STARTER_BLUEPRINT_TEX =
  '% Blueprint\n' +
  '%\n' +
  '% This is the entrypoint of your leanblueprint: a table of contents that\n' +
  '% pulls in per-topic chapter files with \\input{...}. Keep declarations out\n' +
  '% of this file; put your definitions, lemmas, and theorems in chapter files\n' +
  '% under chapters/, or ask Fuse to draft it from your Sources.\n' +
  '\n' +
  `\\input{chapters/${STARTER_CHAPTER_NAME}}\n`;
export const STARTER_CHAPTER_TEX =
  '% Example chapter. Add a chapters/<topic>.tex file per topic and \\input\n' +
  '% each from content.tex. Replace the example below with your own\n' +
  '% declarations, or ask Fuse to draft them.\n' +
  '\n' +
  '\\section{Example Chapter}\n' +
  '\n' +
  '% \\begin{theorem}\n' +
  '%     \\label{thm:example}\n' +
  '%     Informal statement of a theorem.\n' +
  '% \\end{theorem}\n' +
  '% \\begin{proof}\n' +
  '%     Informal proof sketch.\n' +
  '% \\end{proof}\n';

/** Legacy stub kept for reference; no longer written by create. */
export function buildInitialBlueprintTex(title: string): string {
  return `% Blueprint: ${title}\n% Created by Numina\n\n\\begin{document}\n\n% Your blueprint will go here.\n\n\\end{document}\n`;
}

export function starterBlueprintPaths(dir: string, projectSubdir: string): { entrypoint: string; target: string; chapter: string } {
  const entrypoint = defaultBlueprintFileForProject(projectSubdir);
  const target = join(dir, ...entrypoint.split('/'));
  const chapter = join(dirname(target), 'chapters', `${STARTER_CHAPTER_NAME}.tex`);
  return { entrypoint, target, chapter };
}

/** Write the starter entrypoint and chapter when absent; report adoption. */
export async function writeStarterBlueprint(dir: string, projectSubdir: string): Promise<{ existed: boolean; entrypoint: string }> {
  const { entrypoint, target, chapter } = starterBlueprintPaths(dir, projectSubdir);
  const root = resolve(dir);
  const contained = (path: string): boolean => {
    const absolute = resolve(path);
    return absolute === root || absolute.startsWith(root.endsWith(sep) ? root : root + sep);
  };
  if (!contained(target) || !contained(chapter)) throw new HttpError(409, 'The blueprint source path is invalid.', 'http_409');
  if (existsSync(target)) {
    if (!(await pathResolvesUnder(target, dir))) throw new HttpError(409, 'The blueprint source path is invalid.', 'http_409');
    return { existed: true, entrypoint };
  }
  try {
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, STARTER_BLUEPRINT_TEX, 'utf8');
    await fs.mkdir(dirname(chapter), { recursive: true });
    await fs.writeFile(chapter, STARTER_CHAPTER_TEX, 'utf8');
  } catch (error) {
    console.error('Failed to write starter blueprint:', error);
    throw new HttpError(500, 'Failed to create the blueprint file.', 'http_500');
  }
  return { existed: false, entrypoint };
}

/** ``\input{...}`` targets of an entrypoint, as repo-relative ``.tex`` paths. */
function includedFilesOf(dir: string, entrypoint: string, content: string): string[] {
  const base = dirname(entrypoint);
  const included: string[] = [];
  for (const match of content.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
    let target = match[1].trim();
    if (!target.endsWith('.tex')) target = `${target}.tex`;
    const relative = base === '.' ? target : `${base}/${target}`;
    if (existsSync(join(dir, ...relative.split('/')))) included.push(relative);
  }
  return included;
}

/**
 * ``POST /{name}/create-blueprint``: write the starter files (or adopt the
 * existing entrypoint), record it as the blueprint's file and re-parse.
 * Without ``ctx`` only the files are written and the response is derived
 * from the entrypoint's ``\input`` lines.
 */
export async function createStarterBlueprint(project: OpenProject, ctx?: AppContext): Promise<BlueprintSourceFileResponse> {
  if (!existsSync(project.clonePath)) throw new HttpError(409, 'No local clone available for this blueprint.', 'http_409');
  const { existed, entrypoint } = await writeStarterBlueprint(project.clonePath, project.projectSubdir);
  const content = await fs.readFile(join(project.clonePath, ...entrypoint.split('/')), 'utf8').catch(() => '');
  const fallback: BlueprintSourceFileResponse = {
    blueprint_file: entrypoint,
    included_files: includedFilesOf(project.clonePath, entrypoint, content),
    entry_count: 0,
  };
  if (!ctx) return fallback;
  const previous = project.blueprint.blueprint_file;
  const updated = ctx.registry.updateBlueprint(project.repository.id, project.blueprint.id, { blueprint_file: entrypoint });
  const refreshed: OpenProject = { ...project, blueprint: updated, blueprintFile: entrypoint };
  const service = blueprintService(ctx);
  if (!service) return fallback;
  try {
    await service.refresh(refreshed);
    const detail = await service.getBlueprint(refreshed);
    if (existed && detail.entry_count === 0) {
      // Adopting an existing file requires it to actually parse as a leanblueprint.
      ctx.registry.updateBlueprint(project.repository.id, project.blueprint.id, { blueprint_file: previous });
      throw new HttpError(422, `${entrypoint} has no parseable leanblueprint declarations.`, 'http_422');
    }
    return { blueprint_file: entrypoint, included_files: detail.included_files, entry_count: detail.entry_count };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.warn('Blueprint refresh after create-blueprint failed:', error);
    return fallback;
  }
}

// ── Compile-check scaffold (generated into a temp tree, never committed) ──

export const COMPILE_EXCLUDED_DIRECTORIES = new Set(['.git', '.lake', '.claude', 'node_modules', '__pycache__', '.venv']);
export const COMPILE_MAX_COPY_FILES = 4000;
export const COMPILE_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const COMPILE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export const PRINT_TEX = `% Generated by Fuse for the compile check; not committed.
% Mirrors the print scaffold from \`leanblueprint new\`
% (github.com/PatrickMassot/leanblueprint, Apache-2.0).
\\documentclass[a4paper]{report}

\\usepackage{geometry}

\\usepackage{expl3}

\\usepackage{amssymb, amsthm, mathtools}
\\usepackage[unicode,colorlinks=true,linkcolor=blue,urlcolor=magenta,
  citecolor=blue]{hyperref}

\\usepackage[warnings-off={mathtools-colon,mathtools-overbracket}]{unicode-math}

\\input{macros/common}
\\input{macros/print}

\\title{Blueprint}
\\author{}

\\begin{document}
\\maketitle
\\input{__BLUEPRINT_ENTRY__}
\\end{document}
`;

export const LATEXMKRC = `# Generated by Fuse for the blueprint compile check; not committed.
$pdf_mode = 1;
$pdflatex = 'xelatex -synctex=1';
@default_files = ('print.tex');
`;

export const MACROS_COMMON_TEX = `% Generated by Fuse for the compile check; not committed.
% Environments supported by Fuse's leanblueprint parser.
\\newtheorem{theorem}{Theorem}
\\newtheorem{proposition}[theorem]{Proposition}
\\newtheorem{lemma}[theorem]{Lemma}
\\newtheorem{corollary}[theorem]{Corollary}
\\newtheorem{axiom}[theorem]{Axiom}
\\newtheorem{conjecture}[theorem]{Conjecture}
\\newtheorem{hypothesis}[theorem]{Hypothesis}
\\newtheorem{claim}[theorem]{Claim}
\\newtheorem{assumption}[theorem]{Assumption}

\\theoremstyle{definition}
\\newtheorem{definition}[theorem]{Definition}
\\newtheorem{example}[theorem]{Example}
\\newtheorem{notation}[theorem]{Notation}

\\theoremstyle{remark}
\\newtheorem{remark}[theorem]{Remark}
`;

export const MACROS_PRINT_TEX = `% Generated by Fuse for the compile check; not committed.
\\newcommand{\\lean}[1]{}
\\newcommand{\\discussion}[1]{}
\\newcommand{\\leanok}{}
\\newcommand{\\mathlibok}{}
\\newcommand{\\notready}{}
\\ExplSyntaxOn
\\NewDocumentCommand{\\uses}{m}
 {\\clist_map_inline:nn{#1}{\\vphantom{\\ref{##1}}}%
  \\ignorespaces}
\\NewDocumentCommand{\\proves}{m}
 {\\clist_map_inline:nn{#1}{\\vphantom{\\ref{##1}}}%
  \\ignorespaces}
\\ExplSyntaxOff
`;

/** ``print.tex`` for a given entrypoint stem (``content``). */
export function printTexFor(entryStem: string): string {
  return PRINT_TEX.replace('__BLUEPRINT_ENTRY__', entryStem);
}

// ── Lean project scaffold ─────────────────────────────────────────────────

export interface LeanProjectScaffold {
  module_name: string;
  project_subdir: string;
  files: Array<[string, string]>;
}

function buildLakefile(moduleName: string, mathlibRevision: string | null): string {
  const sections = [`name = "${moduleName}"`, `defaultTargets = ["${moduleName}"]`, ''];
  if (mathlibRevision !== null) {
    sections.push('[[require]]', 'name = "mathlib"', 'scope = "leanprover-community"', `version = "git#${mathlibRevision}"`, '');
  }
  sections.push('[[lean_lib]]', `name = "${moduleName}"`, '');
  return sections.join('\n');
}

function buildBasicModule(moduleName: string, withMathlib: boolean): string {
  const lines: string[] = [];
  if (withMathlib) lines.push('import Mathlib', '');
  lines.push(`namespace ${moduleName}`, '', '-- Add your definitions and theorems here.', '', `end ${moduleName}`, '');
  return lines.join('\n');
}

/** Deterministic scaffold files without writing them anywhere. */
export function buildLeanProjectScaffold(
  moduleName: string,
  options: { leanToolchain: string; mathlibRevision: string | null; projectSubdir?: string | null },
): LeanProjectScaffold {
  const module = validateModuleName(moduleName);
  const subdir = validateProjectSubdir(options.projectSubdir);
  const toolchain = validateLeanToolchain(options.leanToolchain);
  const revision = validateMathlibRevision(options.mathlibRevision);
  const prefix = subdir ? `${subdir}/` : '';
  return {
    module_name: module,
    project_subdir: subdir,
    files: [
      [`${prefix}lakefile.toml`, buildLakefile(module, revision)],
      [`${prefix}lean-toolchain`, toolchain],
      [`${prefix}${module}.lean`, `import ${module}.Basic\n`],
      [`${prefix}${module}/Basic.lean`, buildBasicModule(module, revision !== null)],
    ],
  };
}

const MATHLIB_TOOLCHAIN_URL = 'https://raw.githubusercontent.com/leanprover-community/mathlib4/master/lean-toolchain';
// Fallback when fetching Mathlib's pinned toolchain fails; a known-good recent stable.
export const FALLBACK_LEAN_TOOLCHAIN = 'leanprover/lean4:v4.13.0\n';

/** Mathlib's current ``lean-toolchain`` content, or the fallback (10 s budget). */
export async function fetchMathlibLeanToolchain(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetchImpl(MATHLIB_TOOLCHAIN_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return FALLBACK_LEAN_TOOLCHAIN;
    const content = (await response.text()).trim();
    if (!content) return FALLBACK_LEAN_TOOLCHAIN;
    return `${content}\n`;
  } catch {
    return FALLBACK_LEAN_TOOLCHAIN;
  }
}

export interface ScaffoldLeanProjectOptions {
  moduleName: string;
  leanVersion?: string | null;
  targetSubdir?: string | null;
  /**
   * The branch the caller expects to set up. Setup never switches branches:
   * a value other than the checked-out branch is refused with 409.
   */
  baseBranch?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * ``POST /:owner/:repo/setup``: write the minimal Lean project into the
 * folder, leaving the new files uncommitted. 422 for invalid input, 409 when a target file already
 * exists or ``baseBranch`` is not the checked-out branch.
 */
export async function scaffoldLeanProject(cwd: string, options: ScaffoldLeanProjectOptions): Promise<RepositorySetupResult> {
  // Validators throw WorkspaceValidationError (a 422 HttpError) with the web's messages.
  const moduleName = validateModuleName(options.moduleName);
  const leanVersion = options.leanVersion ? validateLeanVersion(options.leanVersion) : null;
  const subdir = validateProjectSubdir(options.targetSubdir);
  const toolchain = leanVersion === null ? await fetchMathlibLeanToolchain(options.fetchImpl) : `leanprover/lean4:${leanVersion}\n`;
  const scaffold = buildLeanProjectScaffold(moduleName, {
    leanToolchain: toolchain,
    mathlibRevision: leanVersion === null ? 'master' : leanVersion,
    projectSubdir: subdir,
  });
  const isRepo = await isGitRepository(cwd);
  const branch = isRepo ? await currentBranch(cwd) : null;
  const base = (options.baseBranch ?? '').trim().replace(/^refs\/heads\//, '');
  if (branch && base && base !== branch) {
    throw new HttpError(409, `Setup runs on the checked-out branch (${branch}); check out ${base} in the folder first.`, 'http_409');
  }
  const writeFiles = async (): Promise<void> => {
    if (isRepo) await requireNoUnresolvedMerge(cwd);
    const location = branch ?? 'this folder';
    for (const [path] of scaffold.files) {
      if (existsSync(join(cwd, ...path.split('/')))) {
        throw new HttpError(409, `'${path}' already exists on ${location}; setup would overwrite it.`, 'http_409');
      }
    }
    for (const [path, content] of scaffold.files) {
      const absolute = join(cwd, ...path.split('/'));
      await fs.mkdir(dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, 'utf8');
    }
  };
  await withRepositoryLock(cwd, writeFiles);
  return {
    default_branch: branch ?? 'main',
    module_name: moduleName,
    project_subdir: scaffold.project_subdir,
    pull_request_url: null,
    pull_request_number: null,
  };
}
