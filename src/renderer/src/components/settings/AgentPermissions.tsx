import { useId, useState } from 'react';
import type { AgentDefaults } from '@shared/desktop';
import type { ProviderId } from '@shared/agent-events';
import { Select } from '@/components/ui/select';
import ConfirmDialog from '@/features/blueprint/components/ConfirmDialog';

type Permissions = Pick<AgentDefaults, 'claude_permission_mode' | 'codex_sandbox'>;

const CLAUDE_OPTIONS = [
  { value: 'acceptEdits', label: 'Ask for commands, allow file edits', help: 'Allows file edits; asks before other tools when needed.' },
  { value: 'manual', label: 'Standard approvals', help: 'Asks when a tool needs permission. Existing CLI rules still apply.' },
  { value: 'plan', label: 'Plan only (no edits)', help: 'Inspects the project and plans changes without making them.' },
  { value: 'bypassPermissions', label: 'Bypass permissions (dangerous)', help: 'No approval prompts. Files outside the repository may be changed.' },
] as const;
const CODEX_OPTIONS = [
  { value: 'workspace-write', label: 'Workspace write (default)', help: 'Edits within the sandbox; other writes are blocked without prompting.' },
  { value: 'read-only', label: 'Read only', help: 'Can read files. Writes are blocked, without approval prompts.' },
  { value: 'danger-full-access', label: 'Full access (dangerous)', help: 'No sandbox or approvals. Files outside the repository may be changed.' },
] as const;

/** The same editable safety controls in app defaults and workspace overrides. */
export function AgentPermissions({ provider, config, onChange, scope, disabled = false }: {
  provider: ProviderId;
  config: Permissions;
  onChange: (patch: Partial<Permissions>) => void | Promise<boolean>;
  scope: 'defaults' | 'workspace';
  disabled?: boolean;
}) {
  const id = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claude = provider === 'claude';
  const options = claude ? CLAUDE_OPTIONS : CODEX_OPTIONS;
  const value = claude ? config.claude_permission_mode : config.codex_sandbox;
  const dangerous = options[options.length - 1];
  const selected = options.find(option => option.value === value)!;
  const label = scope === 'defaults'
    ? claude ? 'Claude Code permissions' : 'Codex sandbox'
    : claude ? 'Permissions' : 'Sandbox';
  const scopeHelp = scope === 'defaults'
    ? 'Saved as the default for new workspaces only. Existing workspaces keep their own settings; change them in workspace Settings → Agent.'
    : 'Applies to new chats in this workspace. A running turn is not changed.';
  const risk = claude
    ? 'Skips permission prompts with --dangerously-skip-permissions. Commands can run with your account’s access, including outside the repository. A disposable project folder is not a sandbox.'
    : 'Disables sandboxing and approval prompts with --dangerously-bypass-approvals-and-sandbox. Commands can modify or delete files outside the repository with your account’s access.';

  async function apply(next: string) {
    if (disabled || busy) return;
    setError(null);
    setBusy(true);
    try {
      const patch: Partial<Permissions> = claude
        ? { claude_permission_mode: next as Permissions['claude_permission_mode'] }
        : { codex_sandbox: next as Permissions['codex_sandbox'] };
      const result = await onChange(patch);
      if (result === false) setError('Could not save permissions. Try again.');
      else setConfirmOpen(false);
    } catch {
      setError('Could not save permissions. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <Select id={id} ariaLabel={label} value={value} options={options} disabled={disabled || busy}
        className="w-full max-w-sm px-3.5 py-2"
        onValueChange={(next) => {
          if (next === value || disabled || busy) return;
          setError(null);
          if (next === dangerous.value) setConfirmOpen(true);
          else void apply(next);
        }} />
      <p role={value === dangerous.value ? 'note' : undefined}
        className={`text-xs leading-relaxed ${value === dangerous.value ? 'text-destructive' : 'text-muted-foreground'}`}>
        {selected.help}
      </p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <ConfirmDialog open={confirmOpen} title={claude ? 'Bypass Claude Code permissions?' : 'Give Codex full access?'}
        message={`${risk} ${scopeHelp}${error ? ` ${error}` : ''}`}
        confirmLabel={claude ? 'Enable bypass permissions' : 'Enable full access'}
        destructive busy={busy || disabled} onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void apply(dangerous.value)} />
    </div>
  );
}
