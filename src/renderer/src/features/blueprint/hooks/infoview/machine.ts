import { ApiError } from '@/lib/api';
import { applyDiagnosticResponse, applyGoalResponse } from './normalization';
import {
  createInfoviewRequestClient,
  type InfoviewRequestClient,
} from './requests';
import {
  createInfoviewSaveMachine,
  type InfoviewSaveMachine,
} from './save-machine';
import {
  createSelectionTracker,
  type SelectionTracker,
} from './selection';
import {
  emptyHoverResponse,
  type HoverResponse,
  type InfoviewApi,
  type InfoviewState,
} from './types';

const CURSOR_DEBOUNCE = 300;

export interface InfoviewMachineDeps {
  owner: string;
  repo: string;
  blueprintId: string;
  filePathRef: { current: string | null };
  onPendingChangeRef: { current: ((hasPending: boolean) => void) | undefined };
  stateRef: { current: InfoviewState };
  publish: () => void;
}

function infoviewBasePath(deps: InfoviewMachineDeps): string {
  return `/repositories/${encodeURIComponent(deps.owner)}`
    + `/${encodeURIComponent(deps.repo)}`
    + `/blueprints/${encodeURIComponent(deps.blueprintId)}`;
}

class InfoviewMachine {
  private readonly state: InfoviewState;
  private readonly selectionTracker: SelectionTracker;
  private readonly client: InfoviewRequestClient;
  private readonly saveMachine: InfoviewSaveMachine;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private goalsAbortController: AbortController | null = null;
  private diagnosticsAbortController: AbortController | null = null;
  private goalsLoading = false;
  private diagnosticsLoading = false;
  private goalsError: string | ApiError | null = null;
  private diagnosticsError: string | ApiError | null = null;
  private diagnosticsRefreshToken = 0;
  private lastCursorLine = 1;
  private lastCursorColumn = 1;

  constructor(private readonly deps: InfoviewMachineDeps) {
    this.state = deps.stateRef.current;
    this.selectionTracker = createSelectionTracker(deps.filePathRef);
    this.client = createInfoviewRequestClient(infoviewBasePath(deps));
    this.saveMachine = createInfoviewSaveMachine({
      save: this.client.save,
      refresh: async () => this.fetchInfoview(this.lastCursorLine, this.lastCursorColumn),
      getCurrentFilePath: () => this.deps.filePathRef.current,
      onPendingChange: () => this.deps.onPendingChangeRef.current,
      isDisposed: this.selectionTracker.isDisposed,
    });
  }

  toApi(): InfoviewApi {
    return {
      updateCursor: (line, column) => this.updateCursor(line, column),
      saveAndRefresh: this.saveMachine.saveAndRefresh,
      getPendingSaveContent: this.saveMachine.getPendingSaveContent,
      flushPendingSave: this.saveMachine.flushPendingSave,
      reloadFile: () => this.reloadFile(),
      refreshDiagnostics: () => this.fetchDiagnostics(),
      hover: (line, column, signal) => this.hover(line, column, signal),
      dispose: () => this.dispose(),
      onFilePathChange: () => this.onFilePathChange(),
    };
  }

  private updateLoading(): void {
    this.state.loading = this.goalsLoading || this.diagnosticsLoading;
    this.deps.publish();
  }

  private updateError(): void {
    const error = this.diagnosticsError || this.goalsError;
    this.state.error = error instanceof ApiError ? error.message : error;
    this.state.setupRequired = error instanceof ApiError && (
      error.code === 'lean_setup_required'
      || error.message.startsWith('This Lean project is not ready for language services.')
    );
    this.deps.publish();
  }

  private errorForState(error: unknown): string | ApiError {
    return error instanceof ApiError ? error : 'Failed to fetch Infoview data';
  }

  private cancelGoalsFetch(): void {
    this.goalsAbortController?.abort();
    this.goalsAbortController = null;
    this.goalsLoading = false;
  }

  private cancelDiagnosticsFetch(): void {
    this.diagnosticsAbortController?.abort();
    this.diagnosticsAbortController = null;
    this.diagnosticsLoading = false;
  }

  private clearState(): void {
    this.goalsLoading = false;
    this.diagnosticsLoading = false;
    this.goalsError = null;
    this.diagnosticsError = null;
    this.updateLoading();
    this.updateError();
    Object.assign(this.state, {
      goals: [], goalsBefore: [], goalsAfter: [], expectedType: '', lineContext: '',
      diagnostics: [], diagnosticsIncomplete: false,
    });
    // Cursor coordinates belong to the prior file and cannot be reused.
    this.lastCursorLine = 1;
    this.lastCursorColumn = 1;
    this.deps.publish();
  }

  private async fetchGoals(line: number, column: number): Promise<void> {
    const selection = this.selectionTracker.capture();
    if (!selection) return;
    this.cancelGoalsFetch();
    const controller = new AbortController();
    this.goalsAbortController = controller;
    this.goalsLoading = true;
    this.updateLoading();

    try {
      const result = await this.client.goals(selection.filePath, line, column, controller.signal);
      if (controller.signal.aborted || !selection.isCurrent()) return;
      applyGoalResponse(this.state, result);
      this.deps.publish();
      this.goalsError = null;
      this.updateError();
    } catch (error: unknown) {
      if (controller.signal.aborted || this.selectionTracker.isDisposed()) return;
      this.goalsError = this.errorForState(error);
      this.updateError();
    } finally {
      this.finishGoalsFetch(controller);
    }
  }

  private finishGoalsFetch(controller: AbortController): void {
    if (controller.signal.aborted || this.selectionTracker.isDisposed()) return;
    this.goalsLoading = false;
    this.goalsAbortController = null;
    this.updateLoading();
  }

  private async fetchDiagnostics(): Promise<void> {
    const selection = this.selectionTracker.capture();
    if (!selection) return;
    this.diagnosticsRefreshToken += 1;
    this.cancelDiagnosticsFetch();
    const controller = new AbortController();
    this.diagnosticsAbortController = controller;
    this.diagnosticsLoading = true;
    this.updateLoading();

    try {
      const result = await this.client.diagnostics(selection.filePath, controller.signal);
      if (controller.signal.aborted || !selection.isCurrent()) return;
      applyDiagnosticResponse(this.state, result);
      this.deps.publish();
      this.diagnosticsError = null;
      this.updateError();
    } catch (error: unknown) {
      if (controller.signal.aborted || this.selectionTracker.isDisposed()) return;
      this.diagnosticsError = this.errorForState(error);
      this.state.diagnosticsIncomplete = this.state.diagnostics.length > 0;
      this.updateError();
    } finally {
      this.finishDiagnosticsFetch(controller);
    }
  }

  private finishDiagnosticsFetch(controller: AbortController): void {
    if (controller.signal.aborted || this.selectionTracker.isDisposed()) return;
    this.diagnosticsLoading = false;
    this.diagnosticsAbortController = null;
    this.updateLoading();
  }

  private async fetchCachedDiagnostics(expectedFilePath: string): Promise<void> {
    try {
      const result = await this.client.cachedDiagnostics(expectedFilePath);
      if (
        this.selectionTracker.isDisposed()
        || this.deps.filePathRef.current !== expectedFilePath
      ) return;
      this.state.diagnostics = result.items || [];
      this.deps.publish();
    } catch {
      // Best-effort cache; the following live request is authoritative.
    }
  }

  private async fetchCachedThenLiveDiagnostics(): Promise<void> {
    const selection = this.selectionTracker.capture();
    if (!selection) return;
    const refreshToken = ++this.diagnosticsRefreshToken;
    this.diagnosticsLoading = true;
    this.updateLoading();
    await this.fetchCachedDiagnostics(selection.filePath);
    if (!selection.isCurrent() || this.diagnosticsRefreshToken !== refreshToken) return;
    await this.fetchDiagnostics();
  }

  private async fetchInfoview(line: number, column: number): Promise<void> {
    await Promise.allSettled([
      this.fetchGoals(line, column),
      this.fetchDiagnostics(),
    ]);
  }

  private updateCursor(line: number, column: number): void {
    if (this.selectionTracker.isDisposed()) return;
    this.lastCursorLine = line;
    this.lastCursorColumn = column;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(
      () => void this.fetchInfoview(line, column),
      CURSOR_DEBOUNCE,
    );
  }

  private async reloadFile(): Promise<boolean> {
    const selection = this.selectionTracker.capture();
    if (!selection) return false;
    const flush = this.saveMachine.flushPendingSave(false);
    const saved = flush ? await flush : true;
    if (!selection.isCurrent()) return false;
    if (!saved) {
      this.diagnosticsError = 'Could not save your changes; the file was not reloaded.';
      this.updateError();
      return false;
    }

    try {
      await this.client.reload(selection.filePath);
    } catch (error: unknown) {
      if (this.selectionTracker.isDisposed()) return false;
      this.diagnosticsError = this.errorForState(error);
      this.updateError();
      return false;
    }
    if (!selection.isCurrent()) return true;
    await this.fetchInfoview(this.lastCursorLine, this.lastCursorColumn);
    return true;
  }

  /** Hover never publishes state; the initiating tooltip owns cancellation. */
  private async hover(
    line: number,
    column: number,
    signal: AbortSignal,
  ): Promise<HoverResponse> {
    const selection = this.selectionTracker.capture();
    if (!selection) return emptyHoverResponse();
    const result = await this.client.hover(selection.filePath, line, column, signal);
    if (signal.aborted || !selection.isCurrent()) return emptyHoverResponse();
    return result;
  }

  private dispose(): void {
    if (this.selectionTracker.isDisposed()) return;
    this.selectionTracker.dispose();
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    void this.saveMachine.flushPendingSave(false);
    this.cancelGoalsFetch();
    this.cancelDiagnosticsFetch();
    this.updateLoading();
  }

  private onFilePathChange(): void {
    this.saveMachine.flushPendingSave(false);
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
    this.cancelGoalsFetch();
    this.cancelDiagnosticsFetch();
    this.clearState();
    if (this.deps.filePathRef.current) void this.fetchCachedThenLiveDiagnostics();
  }
}

/**
 * The class is private so the hook exposes only the original function-based
 * API; wrappers also keep method identity and `this` binding stable.
 */
export function createInfoviewMachine(deps: InfoviewMachineDeps): InfoviewApi {
  return new InfoviewMachine(deps).toApi();
}
