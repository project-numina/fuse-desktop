import { useEffect, useRef, useState } from 'react';

import { AgentSettingsSection } from './settings-mode/AgentSettingsSection';
import { GeneralSettingsSection } from './settings-mode/GeneralSettingsSection';
import { SETTINGS_SECTIONS, type SettingsSection } from './settings-mode/helpers';
import {
  BlueprintSourcePickerDialog,
  LakefilePickerDialog,
} from './settings-mode/SettingsDialogs';
import { SettingsNavigation } from './settings-mode/SettingsNavigation';
import type { SettingsModeProps } from './settings-mode/types';
import { useAgentSettings } from './settings-mode/use-agent-settings';
import { useGeneralSettings } from './settings-mode/use-general-settings';
import { useLakefilePicker } from './settings-mode/use-lakefile-picker';
import { useRemoveWorkspace } from './settings-mode/use-remove-workspace';
import { useSourcePicker } from './settings-mode/use-source-picker';
import {
  RemoveWorkspaceDialog,
  RemoveWorkspaceSection,
} from './settings-mode/WorkspaceRemoval';

export type {
  BlueprintRef,
  PullRequestMode,
  SettingsModeProps,
  SettingsUpdatedPayload,
  SourceUpdatedPayload,
} from './settings-mode/types';

function SettingsMode({
  blueprint,
  owner,
  repo,
  blueprintId,
  readonly = false,
  readonlyReason = 'This workspace is read-only.',
  onUpdated,
  onSourceUpdated,
  onProjectUpdated,
  beforeProjectChange,
  onRemoved,
}: SettingsModeProps) {
  const [section, setSection] = useState<SettingsSection>('general');
  const operationLock = useRef<'general' | 'agent' | null>(null);
  const agent = useAgentSettings({
    blueprint,
    owner,
    repo,
    blueprintId,
    readonly,
    operationLock,
    onUpdated,
  });
  const general = useGeneralSettings({
    blueprint,
    owner,
    repo,
    blueprintId,
    readonly,
    operationLock,
    onUpdated,
  });
  const lakefile = useLakefilePicker({
    owner,
    repo,
    blueprintId,
    projectSubdir: blueprint.project_subdir || '',
    readonly,
    beforeProjectChange,
    onProjectUpdated,
  });
  const source = useSourcePicker({
    owner,
    repo,
    blueprintId,
    readonly,
    onSourceUpdated,
  });
  const removal = useRemoveWorkspace({ owner, repo, blueprintId, onRemoved });

  useEffect(() => {
    setSection('general');
  }, [blueprint.id]);

  const currentSection = SETTINGS_SECTIONS.find((item) => item.id === section)!;
  return (
    <div className="@container mx-auto w-full max-w-[1000px] px-6 pb-12 pt-10">
      <h2 className="mb-8 text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
      <div className="flex flex-col items-start gap-x-10 gap-y-6 @min-[640px]:flex-row">
        <SettingsNavigation section={section} onChange={setSection} />
        <div className="min-w-0 w-full flex-1">
          <header className="mb-6">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {currentSection.label}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {currentSection.description}
            </p>
          </header>
          <div className="mb-6 border-t border-border pt-6">
            <div hidden={section !== 'general'}>
              <GeneralSettingsSection
                blueprintId={blueprintId}
                currentSourceFile={blueprint.blueprint_file ?? ''}
                projectSubdir={blueprint.project_subdir || ''}
                readonly={readonly}
                readonlyReason={readonlyReason}
                general={general}
                lakefile={lakefile}
                source={source}
              />
            </div>
            <div hidden={section !== 'agent'}>
              <AgentSettingsSection
                blueprintId={blueprint.id}
                readonly={readonly}
                generalSaving={general.saving}
                state={agent}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {section === 'general' && (
              <button
                type="button"
                disabled={!general.canSave || general.saving || agent.saving}
                title={readonly ? readonlyReason : undefined}
                className="btn-outline-accent px-4 py-2"
                onClick={() => void general.saveSettings()}
              >
                {general.saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
            {readonly && (
              <p className="text-xs leading-snug text-muted-foreground">{readonlyReason}</p>
            )}
            {general.errorMessage ? (
              <p className="m-0 ml-auto text-xs text-destructive">{general.errorMessage}</p>
            ) : general.successMessage ? (
              <p className="m-0 ml-auto text-xs text-[var(--status-verified-text)]">
                {general.successMessage}
              </p>
            ) : null}
          </div>
          <div hidden={section !== 'general'}>
            <RemoveWorkspaceSection
              readonly={readonly}
              readonlyReason={readonlyReason}
              state={removal}
            />
          </div>
        </div>
      </div>

      <RemoveWorkspaceDialog workspaceName={blueprint.name || blueprintId} state={removal} />
      <LakefilePickerDialog state={lakefile} />
      <BlueprintSourcePickerDialog state={source} />
    </div>
  );
}

export default SettingsMode;
