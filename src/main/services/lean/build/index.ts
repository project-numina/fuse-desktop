/**
 * The Lean build pipeline for an opened project: toolchain preflight,
 * dependency resolution, the Mathlib olean cache, `lake build` itself, the
 * incremental stamp that lets a reopen skip all of that, and the snapshot
 * update that feeds the file-tree badges.
 *
 * Reporter phases (exact strings; the chat's build card keys on them):
 * `preparing`, `installing_toolchain`, `resolving_deps`, `downloading_cache`,
 * `building`, `up_to_date`, `complete`, `failed`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { BlueprintBuildStatus } from '@shared/api-types';
import { AbortError } from '../async';
import {
  clearDepsReady,
  computeDepsState,
  hasLakefile,
  markDepsReady,
  readSnapshot,
  replaceAll,
  replaceFiles,
  snapshotLeanSourceHashes,
  unchangedSourceHashes,
  type Snapshot,
} from './snapshot';
import {
  computeBuildState,
  deleteBuildStamp,
  readBuildStamp,
  stampMatchesState,
  writeBuildStamp,
  type BuildState,
  type GitRunner,
} from './stamp';
import { buildFailed, errorsOf, runLakeWithDiagnostics, type BuildOutput, type LakeRunResult } from '../diagnostics';
import { isInside, moduleToFile, resolveLenient, toPosix, workspaceExecutionContext, type WorkspaceExecutionContext } from '../paths';
import { leanProcessEnv, runToolCollect } from '../process';
import { withProjectBuildLock } from '../project-lock';
import type { LeanBuildSettings } from '../settings';
import { ensureToolchainInstalled, type EnsureToolchainOptions } from '../toolchain';

export type BuildPhase =
  | 'preparing'
  | 'installing_toolchain'
  | 'resolving_deps'
  | 'linking_deps'
  | 'downloading_cache'
  | 'building'
  | 'up_to_date'
  | 'complete'
  | 'failed';

export type BuildReporter = (phase: BuildPhase, message: string) => void;

export interface PackageInfo {
  rev: string;
  url: string;
}

const SAFE_PATH_COMPONENT = /^[A-Za-z0-9._-]+$/;

/** `{name: {rev, url}}` from `lake-manifest.json`, or null when missing/empty/malformed. */
export function readPackageRevisions(projectRoot: string): Record<string, PackageInfo> | null {
  const manifestPath = join(projectRoot, 'lake-manifest.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object') return null;
  const rawPackages = (manifest as Record<string, unknown>).packages;
  if (!Array.isArray(rawPackages)) return null;
  const packages: Record<string, PackageInfo> = {};
  for (const entry of rawPackages) {
    if (!entry || typeof entry !== 'object') continue;
    // Manifests come flat ({name, rev, url}) or nested ({git: {name, rev, url}}).
    const record = entry as Record<string, unknown>;
    const source = (record.git && typeof record.git === 'object' ? record.git : record) as Record<string, unknown>;
    const { name, rev, url } = source;
    if (typeof name !== 'string' || typeof rev !== 'string' || typeof url !== 'string' || !name || !rev || !url) continue;
    if (!SAFE_PATH_COMPONENT.test(name) || !SAFE_PATH_COMPONENT.test(rev)) continue;
    packages[name] = { rev, url };
  }
  return Object.keys(packages).length ? packages : null;
}

export interface BuildCloneOptions {
  settings: LeanBuildSettings;
  /** false = "dependencies unchanged" fast path (skip manifest/cache refresh). */
  linkDependencies?: boolean;
  reporter?: BuildReporter;
  repositoryPath?: string;
  signal?: AbortSignal;
  /** Test seams. */
  toolchain?: Pick<EnsureToolchainOptions, 'runElan' | 'elanPresent'>;
  lakeRunner?: typeof runLakeWithDiagnostics;
  cacheRunner?: (projectRoot: string, args: string[], timeoutMs: number) => Promise<{ exitCode: number | null; output: string }>;
}

function buildExecutionContext(projectRoot: string, repositoryPath?: string): WorkspaceExecutionContext {
  const project = resolveLenient(projectRoot);
  const repository = resolveLenient(repositoryPath ?? projectRoot);
  if (!isInside(repository, project)) throw new Error('Lean project path must be contained in its repository');
  const context = workspaceExecutionContext(repository, toPosix(relative(repository, project)));
  if (!hasLakefile(context.projectRoot)) {
    throw new Error(`No lakefile.lean or lakefile.toml at clone root: ${context.projectRoot}`);
  }
  return context;
}

async function runLakeSoft(
  projectRoot: string,
  args: string[],
  settings: LeanBuildSettings,
  timeoutMs: number,
  extraEnv: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; output: string }> {
  return runToolCollect('lake', args, { cwd: projectRoot, env: leanProcessEnv(settings, extraEnv), timeoutMs, signal });
}

/**
 * Populate dependencies and compile the project. A non-zero `lake build`
 * exit is returned as a normal `BuildOutput` with `failed`; only timeouts,
 * aborts, toolchain and spawn failures reject.
 */
export async function buildClone(projectRoot: string, options: BuildCloneOptions): Promise<BuildOutput> {
  const context = buildExecutionContext(projectRoot, options.repositoryPath);
  const linkDependencies = options.linkDependencies ?? true;
  const { settings, reporter, signal } = options;
  const project = context.projectRoot;
  const lakeRunner = options.lakeRunner ?? runLakeWithDiagnostics;

  // One lock across dependency preparation and the final build so another
  // process's `lean_build` cannot mutate the same .lake tree meanwhile.
  return withProjectBuildLock(
    project,
    async () => {
      const toolchainOptions: EnsureToolchainOptions = { settings, reporter, signal, ...(options.toolchain ?? {}) };
      await ensureToolchainInstalled(project, toolchainOptions);
      if (linkDependencies) clearDepsReady(project);

      // A freshly scaffolded project has a lakefile but no manifest: resolve
      // it now so the cache path can run on the very first build. Failure
      // propagates — a manifest we cannot resolve means a cold source build.
      if (linkDependencies && !existsSync(join(project, 'lake-manifest.json'))) {
        reporter?.('resolving_deps', 'Resolving dependencies...');
        const update = options.cacheRunner
          ? await options.cacheRunner(project, ['update'], settings.lakeUpdateTimeoutMs)
          : await runLakeSoft(project, ['update'], settings, settings.lakeUpdateTimeoutMs, {}, signal);
        if (update.exitCode !== 0) {
          throw new Error(`lake update failed (exit ${update.exitCode}): ${update.output.trim().slice(-2000)}`);
        }
        await ensureToolchainInstalled(project, toolchainOptions);
      }

      const packages = readPackageRevisions(project);
      const hasMathlib = packages !== null && 'mathlib' in packages;
      // No shared package cache on the desktop: lake manages .lake/packages
      // itself, so "cached" only means Mathlib's oleans are already present.
      const cached = existsSync(join(project, '.lake', 'packages', 'mathlib', '.lake', 'build'));
      if (hasMathlib && (linkDependencies || !cached)) {
        reporter?.('downloading_cache', 'Downloading Mathlib cache...');
        const extraEnv: Record<string, string> = {};
        if (settings.mathlibDownloadCacheDir) extraEnv.MATHLIB_CACHE_DIR = settings.mathlibDownloadCacheDir;
        try {
          const result = options.cacheRunner
            ? await options.cacheRunner(project, ['exe', 'cache', 'get'], settings.lakeCacheGetTimeoutMs)
            : await runLakeSoft(project, ['exe', 'cache', 'get'], settings, settings.lakeCacheGetTimeoutMs, extraEnv, signal);
          if (result.exitCode !== 0) console.warn(`[lean] lake exe cache get exited ${result.exitCode}; continuing with a source build`);
        } catch (error) {
          if (error instanceof AbortError) throw error;
          // Soft phase: a missing network or a timeout just means a slower build.
          console.warn(`[lean] lake exe cache get failed: ${(error as Error).message}`);
        }
      }

      // The LSP only needs dependencies present, so open the gate before the
      // (possibly long) final build.
      markDepsReady(project, computeDepsState(project));
      try {
        reporter?.('building', 'Building Lean project...');
        const result: LakeRunResult = await lakeRunner(project, ['build'], { settings, timeoutMs: settings.leanBuildTimeoutMs, signal });
        result.output.exitCode = result.exitCode;
        return result.output;
      } catch (error) {
        if (linkDependencies) clearDepsReady(project);
        throw error;
      }
    },
    { signal },
  );
}

export interface ProjectBuildOptions {
  settings: LeanBuildSettings;
  reporter?: BuildReporter;
  preparing?: boolean;
  signal?: AbortSignal;
  /** Receives the project-relative counts after the snapshot is rewritten. */
  publish?: (snapshot: Snapshot) => void;
  gitRunner?: GitRunner;
  buildRunner?: typeof buildClone;
  toolchain?: BuildCloneOptions['toolchain'];
}

function publishBuildSnapshot(projectRoot: string, output: BuildOutput, observed: Record<string, string>, publish?: (snapshot: Snapshot) => void): Snapshot {
  // An exit without positional errors is an infrastructure failure (bad
  // lakefile, killed worker): keep the last known snapshot rather than
  // wiping every badge.
  const snapshot =
    output.exitCode === 0 || errorsOf(output).length > 0
      ? replaceAll(projectRoot, output.diagnostics, unchangedSourceHashes(projectRoot, observed))
      : readSnapshot(projectRoot);
  publish?.(snapshot);
  return snapshot;
}

/**
 * Build only when the persisted stamp does not match the current inputs.
 * Returns null when the stamp short-circuited the call; otherwise the
 * output of the attempt (clean or errored — both are recorded).
 */
export async function runProjectBuildIfNeeded(context: WorkspaceExecutionContext, options: ProjectBuildOptions): Promise<BuildOutput | null> {
  const { settings, reporter } = options;
  const buildRunner = options.buildRunner ?? buildClone;
  const project = context.projectRoot;
  const stamp = readBuildStamp(project);
  const state = await computeBuildState(context.repositoryRoot, project, { gitRunner: options.gitRunner });
  const dependenciesMatch = stamp !== null && stamp.toolchain_hash === state.toolchain_hash && stamp.manifest_hash === state.manifest_hash;
  if (stampMatchesState(stamp, state)) {
    reporter?.('up_to_date', 'Build up to date');
    return null;
  }
  if (options.preparing) reporter?.('preparing', 'Preparing workspace...');
  const observed = snapshotLeanSourceHashes(project);
  const output = await buildRunner(project, {
    settings,
    linkDependencies: !dependenciesMatch,
    reporter,
    repositoryPath: context.repositoryRoot,
    signal: options.signal,
    toolchain: options.toolchain,
  });
  const finalState: BuildState = await computeBuildState(context.repositoryRoot, project, { gitRunner: options.gitRunner });
  writeBuildStamp(project, finalState, buildFailed(output) ? 'errors' : 'ok');
  publishBuildSnapshot(project, output, observed, options.publish);
  reporter?.('complete', 'Build complete');
  return output;
}

/** First build of a fresh project: drops any stamp, builds, records the outcome. */
export async function runFreshProjectBuild(context: WorkspaceExecutionContext, options: ProjectBuildOptions): Promise<BuildOutput> {
  const { settings, reporter } = options;
  const buildRunner = options.buildRunner ?? buildClone;
  const project = context.projectRoot;
  deleteBuildStamp(project);
  const observed = snapshotLeanSourceHashes(project);
  const output = await buildRunner(project, { settings, reporter, repositoryPath: context.repositoryRoot, signal: options.signal, toolchain: options.toolchain });
  const state = await computeBuildState(context.repositoryRoot, project, { gitRunner: options.gitRunner });
  writeBuildStamp(project, state, buildFailed(output) ? 'errors' : 'ok');
  publishBuildSnapshot(project, output, observed, options.publish);
  reporter?.('complete', 'Build complete');
  return output;
}

export interface ModuleBuildOptions {
  settings: LeanBuildSettings;
  reporter?: BuildReporter;
  signal?: AbortSignal;
  publish?: (snapshot: Snapshot) => void;
  lakeRunner?: typeof runLakeWithDiagnostics;
  toolchain?: BuildCloneOptions['toolchain'];
}

/**
 * `lake build <module>`: the snapshot is updated only for the target module
 * and every module Lake printed a `Building X` line for, so a clean module
 * rebuild clears stale errors without touching the rest of the project.
 */
export async function runModuleBuild(context: WorkspaceExecutionContext, module: string, options: ModuleBuildOptions): Promise<BuildOutput> {
  const { settings, reporter } = options;
  const project = context.projectRoot;
  if (!hasLakefile(project)) throw new Error(`No lakefile.lean or lakefile.toml at clone root: ${project}`);
  const lakeRunner = options.lakeRunner ?? runLakeWithDiagnostics;
  return withProjectBuildLock(
    project,
    async () => {
      await ensureToolchainInstalled(project, { settings, reporter, signal: options.signal, ...(options.toolchain ?? {}) });
      const observed = snapshotLeanSourceHashes(project);
      reporter?.('building', `Building ${module}`);
      const result = await lakeRunner(project, ['build', module], { settings, timeoutMs: settings.leanBuildTimeoutMs, signal: options.signal });
      result.output.exitCode = result.exitCode;
      const output = result.output;
      if (output.exitCode === 0 || errorsOf(output).length > 0) {
        const filesInScope = new Set([...output.builtModules, module].map(moduleToFile));
        const snapshot = replaceFiles(project, filesInScope, output.diagnostics, unchangedSourceHashes(project, observed));
        options.publish?.(snapshot);
      } else {
        options.publish?.(readSnapshot(project));
      }
      reporter?.('complete', 'Build complete');
      return output;
    },
    { signal: options.signal },
  );
}

/** The persisted `GET .../build-status` payload: "done" whenever a stamp exists. */
export function persistedBuildStatus(projectRoot: string): BlueprintBuildStatus {
  const stamp = readBuildStamp(projectRoot);
  if (stamp === null) return { status: 'not_built', head: null, toolchain_hash: null, manifest_hash: null };
  return { status: 'done', head: stamp.head, toolchain_hash: stamp.toolchain_hash, manifest_hash: stamp.manifest_hash };
}
