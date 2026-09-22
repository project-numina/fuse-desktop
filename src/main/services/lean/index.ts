/**
 * Lean integration: `LeanService` (registered as `ctx.services.lean`) plus
 * the building blocks other modules may reuse — the lake output parser, the
 * build snapshot file, the build stamp, and the language-server client.
 */

export { LeanService, MAX_LEAN_FILE_BYTES, atomicWriteText, type BuildOutcome, type StartBuildOptions } from './service';
export { leanSettingsFromEnv, DEFAULT_LEAN_SETTINGS, buildStaleAfterMs, type LeanBuildSettings } from './settings';
export {
  DiagnosticAccumulator,
  runLakeWithDiagnostics,
  errorsOf,
  warningsOf,
  buildFailed,
  newBuildOutput,
  type BuildOutput,
  type Diagnostic,
  type LakeRunResult,
} from './diagnostics';
export * from './build/snapshot';
export { readBuildStamp, writeBuildStamp, deleteBuildStamp, computeBuildState, stampMatchesState, STAMP_FILE, type BuildStamp, type BuildState as BuildStampState } from './build/stamp';
export { buildClone, runProjectBuildIfNeeded, runFreshProjectBuild, runModuleBuild, persistedBuildStatus, readPackageRevisions, type BuildReporter, type BuildPhase } from './build';
export { BuildBus, BuildState, BuildCoordinator, SnapshotWatcher, type BuildSnapshotPayload } from './build/events';
export { withProjectBuildLock, LeanProjectBuildBusyError, PROJECT_BUILD_LOCK_FILE } from './project-lock';
export { readToolchainSpec, readToolchainSlug, ensureToolchainInstalled, LeanToolchainMissingError } from './toolchain';
export * from './paths';
export { leanServiceError, leanPreparingError, LEAN_PREPARING_DETAIL } from './errors';
export { LeanLSPClient, type LeanLSPConfig } from './lsp/client';
export * from './lsp/models';
export * from './lsp/errors';
export { isStaleImportHeaderError, diagnosticReportIsAuthoritative, lineRange, hoverContentsMarkdown } from './lsp/diagnostics';
export {
  LeanLSPService,
  LeanToolError,
  processDiagnostics,
  searchSymbols,
  BUILD_IN_PROGRESS_MESSAGE,
  type DiagnosticsResult,
  type DiagnosticMessage,
  type GoalQuery,
  type TermGoalQuery,
  type HoverQuery,
} from './lsp/service';
export { LeanProjectRegistry } from './registry';
export { listLeanVersions, installedLeanVersions } from './versions';
export { loogleRemote, type LoogleResults, type LoogleResult } from './loogle';
