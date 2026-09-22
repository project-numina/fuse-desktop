import { useEffect, useState, type KeyboardEvent } from 'react';
import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import type { AgentDefaults, AppSettings, ProviderInfo } from '@shared/desktop';
import { ModelPicker } from '@/components/settings/ModelPicker';
import {
  EFFORT_LEVELS,
  type EffortLevel,
  type ProviderId,
} from '@shared/agent-events';
import { Button } from '@/components/ui/button';
import { AgentPermissions } from '@/components/settings/AgentPermissions';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import type { DesktopSettingsState } from '@/desktop/use-desktop-settings';

/**
 * Settings sections that only exist on the desktop: the display name used
 * for commits, where the CLIs live, the agent configuration new workspaces
 * start from, and the git extras. Each control saves as soon as it is
 * committed (blur / Enter / pick / toggle) — there is no separate Save
 * button, matching how the Appearance section already behaves.
 */

export interface DesktopSectionProps {
  state: DesktopSettingsState;
  update: (patch: Partial<AppSettings>) => Promise<boolean>;
  detect: () => Promise<void>;
}

const sectionClass = 'border-t border-border py-6';
const headingClass = 'mb-3 text-lg font-semibold text-foreground';
const copyClass = 'mb-4 text-sm leading-normal text-muted-foreground';
const labelClass = 'mb-1.5 block text-sm font-medium text-foreground/80';
const helpClass = 'mt-1.5 text-xs leading-normal text-muted-foreground';
const fieldClass = 'h-auto max-w-md rounded-md bg-card px-3 py-2 focus-visible:border-primary focus-visible:ring-0';

const PROVIDER_OPTIONS: SelectOption<ProviderId>[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

/** '' stands for "let the CLI decide" because `Select` values are strings. */
const EFFORT_DEFAULT = '';
const EFFORT_OPTIONS: SelectOption<string>[] = [
  { value: EFFORT_DEFAULT, label: 'CLI default' },
  ...EFFORT_LEVELS.map((level) => ({ value: level, label: level })),
];



/**
 * Text field that keeps a local draft and commits it on blur or Enter. The
 * draft resets whenever the saved value changes underneath it (e.g. after a
 * save round-trips through the main process).
 */
function CommitOnBlurInput({
  id,
  value,
  onCommit,
  placeholder,
  ariaLabel,
  list,
  mono = false,
}: {
  id: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  list?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }

  return (
    <Input
      id={id}
      type="text"
      list={list}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      className={`${fieldClass} ${mono ? 'font-mono text-sm' : ''}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

function ProviderStatus({ provider, detecting }: { provider: ProviderInfo; detecting: boolean }) {
  if (detecting) {
    return <span className="text-xs text-muted-foreground">Checking…</span>;
  }
  if (provider.available) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2Icon className="size-3.5 flex-shrink-0 text-[var(--status-proved-text)]" aria-hidden />
        <span className="truncate">{provider.version || 'Detected'}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
      <XCircleIcon className="size-3.5 flex-shrink-0" aria-hidden />
      <span className="truncate">{provider.error ?? 'Not found'}</span>
    </span>
  );
}

/** Static rows so the section renders before the first detection finishes. */
const PROVIDER_ROWS: { id: ProviderId; label: string; command: string; key: 'claudePath' | 'codexPath' }[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', key: 'claudePath' },
  { id: 'codex', label: 'Codex', command: 'codex', key: 'codexPath' },
];

export function CliSection({ state, update, detect }: DesktopSectionProps) {
  if (!state.available || !state.settings) return null;
  const settings = state.settings;
  return (
    <section className={sectionClass}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-foreground">Command-line tools</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state.detecting}
          onClick={() => void detect()}
        >
          {state.detecting ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      <p className={copyClass}>
        Fuse runs the Claude Code and Codex CLIs installed on this machine. Sign in with each
        one in a terminal first (<code className="font-mono text-xs">claude</code> /{' '}
        <code className="font-mono text-xs">codex login</code>); Fuse reuses those
        credentials.
      </p>
      <div className="flex flex-col gap-5">
        {PROVIDER_ROWS.map((row) => {
          const provider = state.providers.find((candidate) => candidate.id === row.id);
          return (
            <div key={row.id}>
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="w-28 shrink-0 text-sm font-medium text-foreground/80">
                  {row.label}
                </span>
                {provider && <ProviderStatus provider={provider} detecting={state.detecting} />}
              </div>
            </div>
          );
        })}
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-muted-foreground">Advanced paths</summary>
        <p className={`${helpClass} mb-4`}>Only needed if Fuse can’t find your CLI or you want to use a different installation. Leave empty to detect it automatically.</p>
        <div className="flex flex-col gap-4">
          {PROVIDER_ROWS.map((row) => (
            <div key={row.id}>
              <label htmlFor={`settings-path-${row.id}`} className={labelClass}>{row.label} executable path</label>
              <CommitOnBlurInput
                id={`settings-path-${row.id}`}
                mono
                value={settings[row.key]}
                ariaLabel={`${row.label} executable path`}
                placeholder={`Path to ${row.command} (empty = use PATH)`}
                onCommit={(next) => {
                  // Re-detect after the override changes so the status line
                  // reflects the executable the agent will actually spawn.
                  void update({ [row.key]: next }).then((ok) => {
                    if (ok) void detect();
                  });
                }}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

export function AgentDefaultsSection({ state, update }: DesktopSectionProps) {
  if (!state.available || !state.settings) return null;
  const defaults = state.settings.agentDefaults;

  function save(patch: Partial<AgentDefaults>) {
    return update({ agentDefaults: { ...defaults, ...patch } });
  }

  return (
    <section className={sectionClass}>
      <h3 className={headingClass}>Default agent</h3>
      <p className={copyClass}>
        Defaults for new workspaces. For an existing workspace, use its Settings → Agent.
      </p>

      <div className="flex flex-col gap-5">
        <div>
          <span className={labelClass}>Provider</span>
          <Select
            value={defaults.provider}
            onValueChange={(provider) => save({ provider })}
            options={PROVIDER_OPTIONS}
            ariaLabel="Default provider"
            className="min-w-50 px-3.5 py-2"
          />
        </div>

        <div>
          <label htmlFor="settings-model" className={labelClass}>
            Model
          </label>
          <ModelPicker
            id="settings-model"
            disabled={state.saving}
            key={defaults.provider}
            provider={defaults.provider}
            value={defaults.model}
            onCommit={(model) => save({ model })}
          />
          <p className={helpClass}>
            Choose CLI default to let the agent pick, or enter a custom model name.
          </p>
        </div>

        <div>
          <span className={labelClass}>Effort</span>
          <Select
            value={defaults.effort ?? EFFORT_DEFAULT}
            onValueChange={(effort) => save({ effort: effort === EFFORT_DEFAULT ? null : (effort as EffortLevel) })}
            options={EFFORT_OPTIONS}
            ariaLabel="Default effort"
            className="min-w-50 px-3.5 py-2"
          />
        </div>

        <section className="border-t border-border pt-6" aria-labelledby="default-permissions-heading">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="default-permissions-heading" className="text-sm font-semibold">Permissions &amp; access</h4>
            <span className="text-xs text-muted-foreground">Saves automatically</span>
          </div>
          <div className="flex flex-col gap-6">
            <AgentPermissions provider="claude" config={defaults} onChange={save} scope="defaults" disabled={state.saving} />
            <AgentPermissions provider="codex" config={defaults} onChange={save} scope="defaults" disabled={state.saving} />
          </div>
        </section>
      </div>
    </section>
  );
}
