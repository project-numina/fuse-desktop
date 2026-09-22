const SAVE_DEBOUNCE = 800;

interface PendingSave {
  filePath: string;
  content: string;
}

interface SaveMachineDeps {
  save: (filePath: string, content: string) => Promise<void>;
  refresh: (filePath: string) => Promise<void>;
  getCurrentFilePath: () => string | null;
  onPendingChange: () => ((hasPending: boolean) => void) | undefined;
  isDisposed: () => boolean;
}

export interface InfoviewSaveMachine {
  saveAndRefresh: (content: string) => void;
  getPendingSaveContent: (filePath: string) => string | undefined;
  flushPendingSave: (refreshAfterSave: boolean) => Promise<boolean> | null;
}

class SaveMachine {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingSaves = new Map<string, string>();
  private readonly pendingContentByFile = new Map<string, string>();
  private saveChain: Promise<boolean> = Promise.resolve(true);
  private inFlightSave: Promise<boolean> | null = null;
  private nextSaveSequence = 0;
  private readonly latestRequestedSequenceByFile: Record<string, number> = {};

  constructor(private readonly deps: SaveMachineDeps) {}

  toApi(): InfoviewSaveMachine {
    return {
      saveAndRefresh: (content) => this.saveAndRefresh(content),
      getPendingSaveContent: (filePath) => this.pendingContentByFile.get(filePath),
      flushPendingSave: (refreshAfterSave) => this.flushPendingSave(refreshAfterSave),
    };
  }

  private notifyPendingChange(): void {
    this.deps.onPendingChange()?.(
      this.pendingSaves.size > 0 || this.inFlightSave !== null,
    );
  }

  private clearSaveTimer(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private async persistSave(save: PendingSave, refreshAfterSave: boolean): Promise<boolean> {
    try {
      await this.deps.save(save.filePath, save.content);
      if (
        refreshAfterSave
        && !this.deps.isDisposed()
        && this.deps.getCurrentFilePath() === save.filePath
      ) {
        await this.deps.refresh(save.filePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  private settleSave(save: PendingSave, sequence: number, ok: boolean): boolean {
    const isLatest = this.latestRequestedSequenceByFile[save.filePath] === sequence;
    if (!isLatest || this.pendingSaves.has(save.filePath)) return ok;
    if (ok) this.pendingContentByFile.delete(save.filePath);
    else {
      this.pendingSaves.set(save.filePath, save.content);
      this.notifyPendingChange();
    }
    return ok;
  }

  /**
   * Serialize writes so an older response cannot overwrite newer content.
   * Only the newest failed write for a file may restore itself to the queue.
   */
  private executeSave(save: PendingSave, refreshAfterSave: boolean): Promise<boolean> {
    const sequence = ++this.nextSaveSequence;
    this.latestRequestedSequenceByFile[save.filePath] = sequence;
    const persist = this.inFlightSave === null
      ? this.persistSave(save, refreshAfterSave)
      : this.saveChain.catch(() => false).then(() => this.persistSave(save, refreshAfterSave));
    const promise = persist
      .then((ok) => this.settleSave(save, sequence, ok))
      .finally(() => {
        if (this.inFlightSave !== promise) return;
        this.inFlightSave = null;
        this.notifyPendingChange();
      });
    this.saveChain = promise;
    this.inFlightSave = promise;
    this.notifyPendingChange();
    return promise;
  }

  private flushPendingSave(refreshAfterSave: boolean): Promise<boolean> | null {
    this.clearSaveTimer();
    if (this.pendingSaves.size === 0) return this.inFlightSave;

    const drained = Array.from(
      this.pendingSaves,
      ([filePath, content]) => ({ filePath, content }),
    );
    this.pendingSaves.clear();
    this.notifyPendingChange();
    let combined: Promise<boolean> = Promise.resolve(true);
    for (const save of drained) {
      const result = this.executeSave(save, refreshAfterSave);
      combined = combined.then((priorOk) => result.then((ok) => priorOk && ok));
    }
    return combined;
  }

  private saveAndRefresh(content: string): void {
    if (this.deps.isDisposed()) return;
    this.clearSaveTimer();
    // Capture now: a file switch before the timer fires must not redirect it.
    const filePath = this.deps.getCurrentFilePath();
    if (!filePath) return;
    this.pendingSaves.set(filePath, content);
    this.pendingContentByFile.set(filePath, content);
    this.notifyPendingChange();
    this.saveTimer = setTimeout(
      () => this.flushPendingSave(true),
      SAVE_DEBOUNCE,
    );
  }
}

export function createInfoviewSaveMachine(deps: SaveMachineDeps): InfoviewSaveMachine {
  return new SaveMachine(deps).toApi();
}
