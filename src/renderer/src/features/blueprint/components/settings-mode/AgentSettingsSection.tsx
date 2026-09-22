import { AgentPermissions } from '@/components/settings/AgentPermissions';
import { ModelPicker } from '@/components/settings/ModelPicker';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { EFFORT_OPTIONS, PROVIDER_OPTIONS } from './helpers';
import type { AgentSettingsState } from './use-agent-settings';

interface AgentSettingsSectionProps {
  blueprintId?: string;
  readonly: boolean;
  generalSaving: boolean;
  state: AgentSettingsState;
}

export function AgentSettingsSection(props: AgentSettingsSectionProps) {
  const { agent, saving, error, updateAgent } = props.state;
  const disabled = props.readonly || props.generalSaving || saving;
  return (
    <div id="workspace-settings-agent" className="flex flex-col gap-6">
      <p role="status" className="text-xs text-muted-foreground">
        {saving ? 'Saving…' : 'Saves automatically · Applies to new chats'}
      </p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="bp-agent-provider-label">
        <span id="bp-agent-provider-label" className="text-sm font-medium leading-[1.5] text-foreground">
          Provider
        </span>
        <div className="flex w-64 overflow-hidden rounded-[var(--radius-md)] border border-[var(--numina-border)] bg-[var(--numina-surface-sunken)]">
          {PROVIDER_OPTIONS.map((option) => {
            const active = agent.provider === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                className={cn(
                  'flex-1 border-0 px-2 py-[0.45rem] text-center text-sm font-medium leading-[1.5] transition-[background,color] disabled:cursor-not-allowed [&+&]:border-l [&+&]:border-l-[var(--numina-border)]',
                  active
                    ? 'bg-[var(--numina-card-bg)] text-[var(--numina-accent)]'
                    : 'bg-transparent text-[var(--text-muted)] hover:enabled:text-[var(--text-primary)]',
                )}
                onClick={() => void updateAgent({ provider: option.value })}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="bp-agent-model" className="text-sm font-medium leading-[1.5] text-foreground">
          Model
        </label>
        <ModelPicker
          key={`${props.blueprintId}-${agent.provider}`}
          id="bp-agent-model"
          provider={agent.provider}
          value={agent.model}
          disabled={disabled}
          onCommit={(model) => updateAgent({ model })}
        />
        <p className="max-w-[60ch] text-xs leading-[1.5] text-muted-foreground">
          Use CLI default or choose a model.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="bp-agent-effort" className="text-sm font-medium leading-[1.5] text-foreground">
          Effort
        </label>
        <Select
          id="bp-agent-effort"
          ariaLabel="Effort"
          value={agent.effort ?? ''}
          disabled={disabled}
          onValueChange={(effort) => updateAgent({ effort: effort || null })}
          options={EFFORT_OPTIONS}
          className="w-full max-w-xs px-3.5 py-2"
        />
        <p className="max-w-[60ch] text-xs leading-[1.5] text-muted-foreground">
          Available levels depend on the model.
        </p>
      </div>

      <ProviderPermissions
        blueprintId={props.blueprintId}
        provider="claude"
        hidden={agent.provider !== 'claude'}
        disabled={disabled}
        state={props.state}
      />
      <ProviderPermissions
        blueprintId={props.blueprintId}
        provider="codex"
        hidden={agent.provider !== 'codex'}
        disabled={disabled}
        state={props.state}
      />
    </div>
  );
}

interface ProviderPermissionsProps {
  blueprintId?: string;
  provider: 'claude' | 'codex';
  hidden: boolean;
  disabled: boolean;
  state: AgentSettingsState;
}

function ProviderPermissions(props: ProviderPermissionsProps) {
  const title = props.provider === 'claude' ? 'Claude Code settings' : 'Codex settings';
  const headingId = `${props.provider}-settings-heading`;
  return (
    <section
      aria-labelledby={headingId}
      hidden={props.hidden}
      className="border-t border-border pt-6"
    >
      <div className="flex flex-col gap-4">
        <h4 id={headingId} className="text-sm font-semibold text-foreground">{title}</h4>
        <AgentPermissions
          key={`${props.provider}-${props.blueprintId}`}
          provider={props.provider}
          config={props.state.agent}
          onChange={props.state.updateAgent}
          scope="workspace"
          disabled={props.disabled}
        />
      </div>
    </section>
  );
}
