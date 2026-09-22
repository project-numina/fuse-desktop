export interface LeanSetupTask {
  directory: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
  message: string;
  steps: string[];
}

export interface LeanSetupStatus {
  repositoryId: number;
  dismissed: boolean;
  threads: number;
  projects: Array<{
    directory: string;
    ready: boolean;
    storage: { availableBytes: number; totalBytes: number } | null;
  }>;
  task: LeanSetupTask | null;
}
