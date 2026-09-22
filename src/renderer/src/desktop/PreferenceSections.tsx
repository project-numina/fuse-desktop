import { useEffect, useId, useState } from 'react';
import { normalizeTextSize, DEFAULT_NOTIFICATIONS, type TextSize, type NotificationPreferences } from '@shared/desktop';
import { useTheme, type ThemePreference } from '@/state/theme';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DisclosureRow } from '@/components/ui/disclosure-row';
import { desktopApi } from './bridge';
import type { DesktopSectionProps } from './DesktopSettingsSections';
import { StorageUsageSection } from './StorageUsageSection';

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return <div className="flex max-w-lg items-center justify-between gap-6 py-3">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </div>;
}

export function NotificationSettings({ state, update }: DesktopSectionProps) {
  if (!state.available || !state.settings) return null;
  const preferences = state.settings.notifications ?? DEFAULT_NOTIFICATIONS;
  const save = (key: keyof NotificationPreferences, value: boolean) => { void update({ notifications: { ...preferences, [key]: value } }); };
  return <section className="border-t border-border py-6">
    <p className="mb-4 text-sm text-muted-foreground">Notify me when Fuse is in the background.</p>
    <Toggle label="Agent finishes" checked={preferences.completed} disabled={state.saving} onChange={value => save('completed', value)} />
    <Toggle label="Agent fails" checked={preferences.failed} disabled={state.saving} onChange={value => save('failed', value)} />
    <Toggle label="Approval needed" checked={preferences.permission} disabled={state.saving} onChange={value => save('permission', value)} />
    <div className="mt-4 border-t border-border pt-4">
      <Toggle label="Notification sound" checked={preferences.sound} disabled={state.saving} onChange={value => save('sound', value)} />
    </div>
  </section>;
}

export function AppearanceSettings({ state, update }: DesktopSectionProps) {
  const { theme, setTheme } = useTheme();
  if (!state.available || !state.settings) return null;
  const sizes = [
    { value: 'small', label: 'Small' },
    { value: 'default', label: 'Default' },
    { value: 'large', label: 'Large' },
    { value: 'extra-large', label: 'Extra large' },
  ];
  return <section className="border-t border-border py-6">
    <label htmlFor="appearance-theme" className="mb-2 block text-sm font-medium">Theme</label>
    <Select id="appearance-theme" ariaLabel="Theme" value={theme} onValueChange={value => setTheme(value as ThemePreference)}
      options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
      className="mb-6 min-w-40 px-3.5 py-2" />
    <label htmlFor="app-text-size" className="mb-2 block text-sm font-medium">Text size</label>
    <Select id="app-text-size" ariaLabel="Text size" value={normalizeTextSize(state.settings.textSize)} disabled={state.saving}
      onValueChange={value => { void update({ textSize: value as TextSize }); }}
      options={sizes}
      className="mb-6 min-w-40 px-3.5 py-2" />
  </section>;
}

export function StorageSettings() {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const api = desktopApi();
  const storage = api?.storage;
  useEffect(() => {
    let active = true;
    if (!storage) return;
    void storage.info().then(info => { if (active) setPath(info.path); })
      .catch(() => { if (active) setError('Could not find the local data folder.'); });
    return () => { active = false; };
  }, [storage]);
  async function run(action: 'open' | 'export') {
    if (!storage || busy) return;
    setBusy(true); setError(null); setExported(null);
    try {
      if (action === 'open') await storage.open();
      else {
        const result = await storage.export();
        if (result) setExported(result.path);
      }
    } catch {
      setError(action === 'open' ? 'Could not open the folder.' : 'Could not export local data. Try another destination outside Fuse’s data folder, or use Open folder to back it up manually.');
    } finally { setBusy(false); }
  }
  return <section className="space-y-6 border-t border-border py-6">
    <StorageUsageSection />
    <div className="border-t border-border">
    <DisclosureRow title="About your data">
      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-sm font-medium">In Fuse’s local folder</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">App and workspace settings, blueprint metadata, imported documents, and Fuse’s saved chat data. Theme, window state, and app caches are also stored locally.</p>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">In your project folders</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">Lean files, LaTeX blueprint sources, and Git history stay in your repository. Fuse reads and edits those files in place; removing a workspace from Fuse does not delete them.</p>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Managed by your agents</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">Claude Code and Codex keep their own local session history, usually under <code>~/.claude</code> and <code>~/.codex</code> unless configured otherwise. Fuse reads that history and reuses each agent’s sign-in. Removing a chat from Fuse does not delete the agent’s copy.</p>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Sent to model providers</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">When you use an agent, prompts, attachments, and project content used as context are sent to its configured model provider. That data is handled under your provider’s account settings and policies, not stored only on this computer.</p>
        </div>
      </div>
    </DisclosureRow>
    <DisclosureRow title="Advanced">
      <h4 className="mb-2 text-sm font-medium">Fuse data folder</h4>
      {path ? <code className="block break-all text-sm text-muted-foreground">{path}</code>
        : <p className="text-sm text-muted-foreground">{storage ? 'Loading…' : api ? 'Restart Fuse to load storage controls.' : 'Open Fuse to access local data.'}</p>}
      <button type="button" className="btn-outline-accent mt-4 px-4 py-2" disabled={!path || busy} onClick={() => void run('open')}>Open folder</button>
      <p className="my-4 text-sm text-muted-foreground">JSON export of Fuse data only—not repositories or CLI-managed history. Automatic restore is not available.</p>
      <p className="mb-4 text-xs text-muted-foreground">Contains private chat content and file paths. Keep it secure.</p>
      <button type="button" className="btn-outline-accent px-4 py-2" disabled={!path || busy} onClick={() => void run('export')}>{busy ? 'Working…' : 'Export local data…'}</button>
    </DisclosureRow>
    </div>
    {exported && <p role="status" className="break-all text-sm text-muted-foreground">Exported to {exported}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
