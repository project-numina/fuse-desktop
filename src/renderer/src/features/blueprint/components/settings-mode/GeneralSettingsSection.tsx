import type { GeneralSettingsState } from './use-general-settings';
import type { LakefilePickerState } from './use-lakefile-picker';
import type { SourcePickerState } from './use-source-picker';

interface GeneralSettingsSectionProps {
  blueprintId: string;
  currentSourceFile: string;
  projectSubdir: string;
  readonly: boolean;
  readonlyReason: string;
  general: GeneralSettingsState;
  lakefile: LakefilePickerState;
  source: SourcePickerState;
}

export function GeneralSettingsSection(props: GeneralSettingsSectionProps) {
  const { general, source, lakefile } = props;
  return (
    <div id="workspace-settings-general" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="bp-name" className="text-sm font-semibold leading-[1.5] text-foreground">
          Name
        </label>
        <input
          id="bp-name"
          disabled={props.readonly}
          type="text"
          value={general.title}
          onChange={(event) => general.setTitle(event.target.value)}
          aria-describedby="name-hint"
          className="w-full max-w-sm rounded-[var(--radius-sm)] border border-[var(--numina-border)] bg-[var(--numina-card-bg)] px-3 py-2 font-[inherit] text-sm leading-[1.5] text-[var(--text-primary)] transition-[border-color,box-shadow] outline-none focus:border-[var(--numina-accent)] focus:shadow-[0_0_0_3px_var(--accent-focus-ring)]"
        />
        <p id="name-hint" className="max-w-[60ch] text-xs leading-[1.5] text-muted-foreground">
          Display name shown on Overview and the dashboard. The URL identifier (
          <code>{props.blueprintId}</code>) stays the same.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="bp-description" className="text-sm font-semibold leading-[1.5] text-foreground">
          Description
        </label>
        <textarea
          id="bp-description"
          disabled={props.readonly}
          value={general.description}
          onChange={(event) => general.setDescription(event.target.value)}
          rows={3}
          placeholder="Short description of the blueprint."
          className="min-h-20 w-full resize-y rounded-[var(--radius-sm)] border border-[var(--numina-border)] bg-[var(--numina-card-bg)] px-3 py-2 font-[inherit] text-sm leading-normal text-[var(--text-primary)] transition-[border-color,box-shadow] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--numina-accent)] focus:shadow-[0_0_0_3px_var(--accent-focus-ring)]"
        />
        <p className="max-w-[60ch] text-xs leading-[1.5] text-muted-foreground">
          Appears on the Overview page and the dashboard.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-foreground">Blueprint source</span>
        <div className="flex items-baseline gap-3">
          {props.currentSourceFile ? (
            <code className="min-w-0 max-w-[32rem] truncate font-mono text-sm text-foreground">
              {props.currentSourceFile}
            </code>
          ) : (
            <span className="text-sm italic text-muted-foreground">Fuse-drafted (default layout)</span>
          )}
          <button
            type="button"
            disabled={props.readonly}
            title={props.readonly ? props.readonlyReason : undefined}
            className="flex-shrink-0 text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            onClick={() => void source.openPicker()}
          >
            Change
          </button>
        </div>
        {source.success && (
          <p className="text-xs text-[var(--status-verified-text)]">{source.success}</p>
        )}
        <p className="max-w-[60ch] text-xs leading-snug text-muted-foreground">
          The leanblueprint <code>.tex</code> entrypoint this project tracks. Changing it
          re-parses the include chain.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-foreground">Lean project (lakefile)</span>
        <div className="flex flex-wrap items-baseline gap-3">
          <code className="min-w-0 break-all text-sm">{props.projectSubdir || 'Repository root'}</code>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline disabled:text-muted-foreground"
            disabled={props.readonly}
            onClick={() => void lakefile.openPicker()}
          >
            Change lakefile
          </button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The selected lakefile sets the Lean environment and the default folder in Files.
          Changing it does not build the project.
        </p>
      </div>
    </div>
  );
}
