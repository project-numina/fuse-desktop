import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { HardDrive, LoaderCircle, X } from 'lucide-react';
import type { LeanSetupStatus, LeanSetupTask } from '@shared/lean-setup';
import { request } from '@/lib/api';
import { OPEN_LEAN_SETUP_EVENT, LEAN_SETUP_READY_EVENT, type LeanSetupTarget } from '@/lib/lean-setup-events';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface LeanSetupPromptProps {
  owner: string;
  repo: string;
  blueprintId: string;
  showLauncher: boolean;
}

type LeanSetupProject = LeanSetupStatus['projects'][number];
type RefreshSetup = (signal?: AbortSignal) => Promise<void>;
type SetError = Dispatch<SetStateAction<string | null>>;

// A normal dismissal lasts until the application reloads. The durable
// preference lives in the main-process repository registry, not web storage.
const promptedProjects = new Set<string>();
const active = (status: LeanSetupStatus | null) => status?.task?.status === 'queued' || status?.task?.status === 'running';
const formatBytes = (bytes: number) => `${(bytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;

function useSetupRefresh(base: string, setStatus: Dispatch<SetStateAction<LeanSetupStatus | null>>, setOpen: Dispatch<SetStateAction<boolean>>) {
  return useCallback(async (signal?: AbortSignal) => {
    const next = await request<LeanSetupStatus>(base, { signal });
    if (signal?.aborted) return;
    setStatus(next);
    const key = `${next.repositoryId}:${next.projects[0]?.directory}`;
    if (!next.dismissed && !promptedProjects.has(key) && !active(next) && next.projects.some((project) => !project.ready)) {
      promptedProjects.add(key);
      setOpen(true);
    }
  }, [base, setOpen, setStatus]);
}

function useInitialSetupStatus(refresh: RefreshSetup) {
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [refresh]);
}

function useSetupPolling(open: boolean, running: boolean, refresh: RefreshSetup, setError: SetError) {
  useEffect(() => {
    if (!open && !running) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void refresh(controller.signal).catch(() => {
        if (!controller.signal.aborted) setError('Could not refresh setup status. Check your connection to Fuse.');
      });
    }, 2500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [open, running, refresh, setError]);
}

function useSetupOpenEvent(props: LeanSetupPromptProps, refresh: RefreshSetup, setOpen: Dispatch<SetStateAction<boolean>>, setError: SetError) {
  const { owner, repo, blueprintId } = props;
  useEffect(() => {
    const handleOpen = (event: Event) => {
      const target = (event as CustomEvent<LeanSetupTarget>).detail;
      if (target?.owner !== owner || target.repo !== repo || target.blueprintId !== blueprintId) return;
      setError(null);
      setOpen(true);
      void refresh().catch(() => setError('Could not load Lean setup. Please try again.'));
    };
    window.addEventListener(OPEN_LEAN_SETUP_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_LEAN_SETUP_EVENT, handleOpen);
  }, [owner, repo, blueprintId, refresh, setError, setOpen]);
}

function useLeanReadyEvent(props: LeanSetupPromptProps, ready: boolean | undefined) {
  const { owner, repo, blueprintId } = props;
  useEffect(() => {
    if (ready) window.dispatchEvent(new CustomEvent(LEAN_SETUP_READY_EVENT, { detail: { owner, repo, blueprintId } }));
  }, [ready, owner, repo, blueprintId]);
}

function useDismissSetup(base: string, status: LeanSetupStatus | null, directory: string | undefined, dontAsk: boolean, setBusy: Dispatch<SetStateAction<boolean>>, setError: SetError, setOpen: Dispatch<SetStateAction<boolean>>) {
  return useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (dontAsk) await request(`${base}/preference`, { method: 'POST', body: JSON.stringify({ dismissed: true }) });
      if (status) promptedProjects.add(`${status.repositoryId}:${directory}`);
      setOpen(false);
    } catch {
      setError('Could not save this preference. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [base, directory, dontAsk, setBusy, setError, setOpen, status]);
}

function useStartSetup(base: string, selected: LeanSetupProject | undefined, dontAsk: boolean, refresh: RefreshSetup, setBusy: Dispatch<SetStateAction<boolean>>, setError: SetError, setHideResult: Dispatch<SetStateAction<boolean>>, setOpen: Dispatch<SetStateAction<boolean>>) {
  return useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (dontAsk) await request(`${base}/preference`, { method: 'POST', body: JSON.stringify({ dismissed: true }) });
      await request(base, { method: 'POST' });
      setHideResult(false);
      await refresh();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start Lean setup.');
    } finally {
      setBusy(false);
    }
  }, [base, dontAsk, refresh, selected, setBusy, setError, setHideResult, setOpen]);
}

function useCancelSetup(base: string, refresh: RefreshSetup, setBusy: Dispatch<SetStateAction<boolean>>, setError: SetError) {
  return useCallback(async () => {
    setBusy(true);
    try {
      await request(`${base}/cancel`, { method: 'POST' });
      await refresh();
    } catch {
      setError('Could not cancel setup. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [base, refresh, setBusy, setError]);
}

function useLeanSetupPrompt(props: LeanSetupPromptProps) {
  const { owner, repo, blueprintId } = props;
  const base = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blueprints/${encodeURIComponent(blueprintId)}/lean/setup`;
  const [status, setStatus] = useState<LeanSetupStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideResult, setHideResult] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const running = active(status);
  const selected = status?.projects[0];
  const refresh = useSetupRefresh(base, setStatus, setOpen);
  useInitialSetupStatus(refresh);
  useSetupPolling(open, running, refresh, setError);
  useSetupOpenEvent(props, refresh, setOpen, setError);
  useLeanReadyEvent(props, selected?.ready);
  const dismiss = useDismissSetup(base, status, selected?.directory, dontAsk, setBusy, setError, setOpen);
  const start = useStartSetup(base, selected, dontAsk, refresh, setBusy, setError, setHideResult, setOpen);
  const cancel = useCancelSetup(base, refresh, setBusy, setError);
  const openPrompt = () => {
    setOpen(true);
    setError(null);
  };
  return { ...props, status, open, dontAsk, busy, error, hideResult, dialogRef, running, selected, setDontAsk, setHideResult, dismiss, start, cancel, openPrompt };
}

type LeanSetupPromptModel = ReturnType<typeof useLeanSetupPrompt>;

function SetupTaskStatus({ task, running, busy, repo, onCancel, onDismiss }: { task: LeanSetupTask; running: boolean; busy: boolean; repo: string; onCancel: () => Promise<void>; onDismiss: () => void }) {
  return <>
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
      {running && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
      <span className="flex-1">{running ? (task.status === 'queued' ? 'Lean setup queued' : 'Setting up Lean…') : task.message}</span>
      {running
        ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onCancel()}>Cancel</Button>
        : <button aria-label="Dismiss setup status" onClick={onDismiss}><X className="size-4" /></button>}
    </div>
    <details className="mt-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Details</summary>
      <p className="mt-2 break-all">{task.directory || repo}</p>
      <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{task.steps.join('\n') || task.message}</div>
    </details>
  </>;
}

function SetupLaunchButton({ onOpen }: { onOpen: () => void }) {
  return <Tooltip>
    <TooltipTrigger render={
      <Button
        type="button"
        variant="outline"
        className="w-full border-primary/50 bg-transparent text-primary hover:border-primary hover:bg-[var(--accent-overlay-soft)] hover:text-primary dark:border-primary/50 dark:bg-transparent dark:hover:bg-[var(--accent-overlay-soft)]"
        onClick={onOpen}
      />
    }>
      Set up Lean
    </TooltipTrigger>
    <TooltipContent side="right">Live Lean checking is off. Set up this project to enable it.</TooltipContent>
  </Tooltip>;
}

function LeanSetupLauncher({ prompt, status }: { prompt: LeanSetupPromptModel; status: LeanSetupStatus }) {
  const { busy, cancel, error, hideResult, open, openPrompt, repo, running, selected, setHideResult, showLauncher } = prompt;
  const task = status.task;
  const showTask = Boolean(task && !hideResult);
  if (open || !((showLauncher && !selected?.ready) || running || showTask)) return null;
  return <div className={showTask ? 'mx-3 border-t border-border pt-3 pb-1' : 'px-3 pt-2'}>
    {showTask && task
      ? <SetupTaskStatus task={task} running={running} busy={busy} repo={repo} onCancel={cancel} onDismiss={() => setHideResult(true)} />
      : <SetupLaunchButton onOpen={openPrompt} />}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}

function ProjectDetails({ directory, repo }: { directory: string | undefined; repo: string }) {
  return <div className="min-w-0 space-y-2">
    <p className="text-sm font-medium">Lean project</p>
    <p className="text-sm">{directory?.split('/').filter(Boolean).at(-1) || repo}</p>
    <p className="min-w-0 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]" data-testid="lean-project-path">{directory || 'Repository root'}</p>
  </div>;
}

function DiskSpace({ storage }: { storage: LeanSetupProject['storage'] }) {
  const usedRatio = storage && storage.totalBytes > 0
    ? Math.max(0, Math.min(1, 1 - storage.availableBytes / storage.totalBytes))
    : null;
  return <div className="min-w-0 space-y-3 border-y border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground"><HardDrive className="size-4 shrink-0" aria-hidden="true" />Disk space</span>
      <span className="tabular-nums">{storage ? `${formatBytes(storage.availableBytes)} available` : 'Unavailable'}</span>
    </div>
    {storage && usedRatio !== null && <>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Disk space used or reserved" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(100 * usedRatio)} aria-valuetext={`${formatBytes(storage.availableBytes)} available of ${formatBytes(storage.totalBytes)}`}>
        <div className="h-full rounded-full bg-muted-foreground/40" style={{ width: `${100 * usedRatio}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{formatBytes(storage.totalBytes)} total · Setup size varies by project</p>
    </>}
    {!storage && <p className="text-xs text-muted-foreground">Available disk space could not be read.</p>}
    {storage && storage.availableBytes < 5_000_000_000 && <p className="text-sm text-destructive">Less than 5 GB is available. Consider freeing space before setup; some projects need substantially more.</p>}
  </div>;
}

function AboutSetup({ threads }: { threads: number }) {
  return <details className="text-xs leading-relaxed text-muted-foreground">
    <summary className="cursor-pointer text-sm outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4">About setup</summary>
    <div className="mt-2 space-y-2">
      <p>Setup can take several minutes and use significant disk space and memory. One setup runs at a time with {threads} Lean worker threads. You can cancel anytime.</p>
      <p>Dependencies and build files stay in the project’s .lake folder; Lean toolchains use your shared elan installation. No reliable size estimate is available before setup.</p>
    </div>
  </details>;
}

function LeanSetupDialog({ prompt, status }: { prompt: LeanSetupPromptModel; status: LeanSetupStatus }) {
  const { busy, dialogRef, dismiss, dontAsk, error, open, repo, running, selected, setDontAsk, start } = prompt;
  const directory = selected?.directory;
  return <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) void dismiss(); }}>
    <DialogContent ref={dialogRef} initialFocus={dialogRef} className="flex max-h-[85vh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={!busy}>
      <div className="min-h-0 min-w-0 space-y-5 overflow-y-auto p-6 pb-2 [overflow-wrap:anywhere]">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="text-lg leading-snug">Set up Lean</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Enable proof goals and live checking for this project. Setup downloads dependencies and builds Lean files. You can keep browsing without it.
          </DialogDescription>
        </DialogHeader>
        <ProjectDetails directory={directory} repo={repo} />
        <DiskSpace storage={selected?.storage ?? null} />
        <AboutSetup threads={status.threads} />
        <label className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground"><input className="mt-1 size-3.5 shrink-0 accent-[var(--primary)]" type="checkbox" checked={dontAsk} disabled={busy} onChange={(event) => setDontAsk(event.target.checked)} />Don’t ask again for this repository</label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="mx-0 mb-0 shrink-0 flex-row justify-end rounded-none border-0 bg-transparent px-6 pt-4 pb-6">
        <Button variant="ghost" disabled={busy} onClick={() => void dismiss()}>Not now</Button>
        <Button disabled={busy || running || !selected} onClick={() => void start()}>{busy ? 'Starting…' : selected?.ready ? 'Check build' : 'Set up Lean'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function LeanSetupPromptView(prompt: LeanSetupPromptModel) {
  if (!prompt.status?.projects.length) return null;
  return <>
    <LeanSetupLauncher prompt={prompt} status={prompt.status} />
    <LeanSetupDialog prompt={prompt} status={prompt.status} />
  </>;
}

export default function LeanSetupPrompt(props: LeanSetupPromptProps) {
  return <LeanSetupPromptView {...useLeanSetupPrompt(props)} />;
}
