/**
 * Tunables for the Lean build pipeline and language server, with the same
 * defaults the hosted backend used. Every value can be overridden through
 * the environment so a slow machine (or a CI runner) can stretch the
 * timeouts without a code change.
 */

export interface LeanBuildSettings {
  /** `LEAN_NUM_THREADS` handed to every lake/lean subprocess. */
  leanNumThreads: number;
  /** Hard cap on one `lake build` invocation. */
  leanBuildTimeoutMs: number;
  /** Cap on `lake exe cache get` and `lake clean` (both best effort). */
  lakeCacheGetTimeoutMs: number;
  /** Cap on `lake update` when a project has no manifest yet. */
  lakeUpdateTimeoutMs: number;
  /** Cap on `elan toolchain install`. */
  toolchainInstallTimeoutMs: number;
  /** 0 = unbounded concurrent `lake build`s across projects. */
  maxConcurrentLeanBuilds: number;
  /** Sets `LAKE_ARTIFACT_CACHE=true` on lake subprocesses. */
  lakeArtifactCache: boolean;
  /** Persistent `MATHLIB_CACHE_DIR` for `lake exe cache get`, when configured. */
  mathlibDownloadCacheDir: string | null;
  /** Documents held open per `lake serve` before LRU eviction. */
  lspMaxOpenedFiles: number;
  /** Diagnostics wait gives up after this long without server activity. */
  lspInactivityTimeoutMs: number;
  /** Idle open documents are closed after this long (0 disables). */
  lspFileIdleTtlMs: number;
  /** A project's `lake serve` is stopped after this long with no window/agent using it. */
  lspProjectIdleMs: number;
  /** Upper bound on live `lake serve` processes; least recently used idle ones go first. */
  lspMaxProjects: number;
}

export const DEFAULT_LEAN_SETTINGS: LeanBuildSettings = {
  leanNumThreads: 2,
  leanBuildTimeoutMs: 900_000,
  lakeCacheGetTimeoutMs: 300_000,
  lakeUpdateTimeoutMs: 600_000,
  toolchainInstallTimeoutMs: 600_000,
  maxConcurrentLeanBuilds: 1,
  lakeArtifactCache: false,
  mathlibDownloadCacheDir: null,
  lspMaxOpenedFiles: 32,
  lspInactivityTimeoutMs: 15_000,
  lspFileIdleTtlMs: 300_000,
  lspProjectIdleMs: 300_000,
  lspMaxProjects: 4,
};

function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envSeconds(name: string, fallbackMs: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallbackMs;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : fallbackMs;
}

/** Settings from the environment (seconds for timeouts, like the hosted backend's env). */
export function leanSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): LeanBuildSettings {
  const fileIdleRaw = env.LEAN_LSP_FILE_IDLE_TTL;
  const fileIdle = fileIdleRaw !== undefined && fileIdleRaw.trim() !== '' ? Number.parseFloat(fileIdleRaw) : Number.NaN;
  return {
    leanNumThreads: Math.max(1, envInt('LEAN_NUM_THREADS', DEFAULT_LEAN_SETTINGS.leanNumThreads, env)),
    leanBuildTimeoutMs: envSeconds('LEAN_BUILD_TIMEOUT', DEFAULT_LEAN_SETTINGS.leanBuildTimeoutMs, env),
    lakeCacheGetTimeoutMs: envSeconds('LAKE_CACHE_GET_TIMEOUT', DEFAULT_LEAN_SETTINGS.lakeCacheGetTimeoutMs, env),
    lakeUpdateTimeoutMs: envSeconds('LAKE_UPDATE_TIMEOUT', DEFAULT_LEAN_SETTINGS.lakeUpdateTimeoutMs, env),
    toolchainInstallTimeoutMs: envSeconds('LEAN_TOOLCHAIN_INSTALL_TIMEOUT', DEFAULT_LEAN_SETTINGS.toolchainInstallTimeoutMs, env),
    maxConcurrentLeanBuilds: envInt('MAX_CONCURRENT_LEAN_BUILDS', DEFAULT_LEAN_SETTINGS.maxConcurrentLeanBuilds, env),
    lakeArtifactCache: (env.LAKE_ARTIFACT_CACHE ?? '').toLowerCase() === 'true',
    mathlibDownloadCacheDir: env.MATHLIB_CACHE_DIR?.trim() || null,
    lspMaxOpenedFiles: Math.max(1, envInt('LEAN_LSP_MAX_OPENED_FILES', DEFAULT_LEAN_SETTINGS.lspMaxOpenedFiles, env)),
    lspInactivityTimeoutMs: envSeconds('LEAN_LSP_INACTIVITY_TIMEOUT', DEFAULT_LEAN_SETTINGS.lspInactivityTimeoutMs, env),
    lspFileIdleTtlMs: Number.isFinite(fileIdle) && fileIdle >= 0 ? Math.round(fileIdle * 1000) : DEFAULT_LEAN_SETTINGS.lspFileIdleTtlMs,
    lspProjectIdleMs: envSeconds('LEAN_LSP_PROJECT_IDLE', DEFAULT_LEAN_SETTINGS.lspProjectIdleMs, env),
    lspMaxProjects: Math.max(1, envInt('LEAN_LSP_MAX_PROJECTS', DEFAULT_LEAN_SETTINGS.lspMaxProjects, env)),
  };
}

/** Grace for work not on its own timeout: LSP teardown, process spawning, stamp and snapshot I/O. */
export const BUILD_STALE_GRACE_MS = 180_000;

/**
 * How long the in-progress flag may stay set before it is treated as stuck:
 * the sum of every bounded phase the flag can cover, plus grace. The hosted
 * backend sized this for its `lean_build` tool alone (clean, cache get, build);
 * here the flag guards the whole session pipeline, which on a first build
 * also lists and installs the pinned toolchain (`elan`, once more after
 * `lake update` bumps the pin) and resolves a missing manifest. Clearing
 * the flag early would let a language server start on half-built oleans.
 */
export function buildStaleAfterMs(settings: LeanBuildSettings): number {
  return (
    4 * settings.toolchainInstallTimeoutMs
    + settings.lakeUpdateTimeoutMs
    + settings.lakeCacheGetTimeoutMs
    + settings.leanBuildTimeoutMs
    + BUILD_STALE_GRACE_MS
  );
}
