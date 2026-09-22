export interface DiagnosticItem {
  severity: string;
  message: string;
  line: number;
  column: number;
  /** Range end (1-indexed); cached diagnostics may omit it. */
  end_line?: number | null;
  end_column?: number | null;
}

export interface InfoviewState {
  loading: boolean;
  goals: string[];
  goalsBefore: string[];
  goalsAfter: string[];
  expectedType: string;
  lineContext: string;
  diagnostics: DiagnosticItem[];
  /** True when the last query did not produce an authoritative verdict. */
  diagnosticsIncomplete: boolean;
  error: string | null;
  setupRequired?: boolean;
}

export interface GoalResponse {
  line_context: string | null;
  goals: string[] | null;
  goals_before: string[] | null;
  goals_after: string[] | null;
  expected_type: string | null;
}

export interface DiagnosticResponse {
  items: DiagnosticItem[];
  /** False when Lean has no authoritative elaboration verdict for the file. */
  complete?: boolean;
  /** Paths of imported files that failed to build. */
  failed_dependencies?: string[];
}

export interface HoverResponse {
  contents: string | null;
  start_line: number | null;
  start_column: number | null;
  end_line: number | null;
  end_column: number | null;
}

export interface InfoviewOptions {
  owner: string;
  repo: string;
  blueprintId: string;
  filePath: string | null;
  /** Reports whether an edit is queued or still reaching the clone. */
  onPendingChange?: (hasPending: boolean) => void;
}

export interface InfoviewApi {
  updateCursor: (line: number, column: number) => void;
  saveAndRefresh: (content: string) => void;
  getPendingSaveContent: (filePath: string) => string | undefined;
  flushPendingSave: (refreshAfterSave: boolean) => Promise<boolean> | null;
  reloadFile: () => Promise<boolean>;
  refreshDiagnostics: () => Promise<void>;
  hover: (line: number, column: number, signal: AbortSignal) => Promise<HoverResponse>;
  dispose: () => void;
  onFilePathChange: () => void;
}

export function initialInfoviewState(): InfoviewState {
  return {
    loading: false,
    goals: [],
    goalsBefore: [],
    goalsAfter: [],
    expectedType: '',
    lineContext: '',
    diagnostics: [],
    diagnosticsIncomplete: false,
    error: null,
  };
}

export function emptyHoverResponse(): HoverResponse {
  return {
    contents: null,
    start_line: null,
    start_column: null,
    end_line: null,
    end_column: null,
  };
}
