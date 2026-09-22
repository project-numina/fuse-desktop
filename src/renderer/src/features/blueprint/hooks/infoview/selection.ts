export interface FileSelection {
  filePath: string;
  isCurrent: () => boolean;
}

export interface SelectionTracker {
  capture: () => FileSelection | null;
  isDisposed: () => boolean;
  dispose: () => void;
}

/**
 * A selection captured before an await is current only while the machine is
 * alive and the same file remains selected. This is the stale-response gate
 * shared by goals, diagnostics, reload, and hover requests.
 */
export function createSelectionTracker(
  filePathRef: { current: string | null },
): SelectionTracker {
  let disposed = false;

  return {
    capture() {
      const filePath = filePathRef.current;
      if (disposed || !filePath) return null;
      return {
        filePath,
        isCurrent: () => !disposed && filePathRef.current === filePath,
      };
    },
    isDisposed: () => disposed,
    dispose: () => {
      disposed = true;
    },
  };
}
