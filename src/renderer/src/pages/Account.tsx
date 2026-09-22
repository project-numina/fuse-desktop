import { useRef, useState } from 'react';
import { Bell, FolderArchive, Settings2, Terminal } from 'lucide-react';
import AppPage from '@/components/layout/AppPage';
import { useDesktopSettings } from '@/desktop/use-desktop-settings';
import { AgentDefaultsSection, CliSection } from '@/desktop/DesktopSettingsSections';
import { AppearanceSettings, NotificationSettings, StorageSettings } from '@/desktop/PreferenceSections';

const sections = [
  { id: 'agents', label: 'Agents', icon: Terminal, description: 'Manage your installed agents and their defaults for new workspaces.' },
  { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Choose when Fuse should notify you.' },
  { id: 'appearance', label: 'Appearance', icon: Settings2, description: 'Theme and text size.' },
  { id: 'storage', label: 'Data', icon: FolderArchive, description: 'What Fuse uses and where it’s stored.' },
] as const;

/** One page scrollbar; the heading and navigation stay pinned on the left. */
export default function Account() {
  const desktop = useDesktopSettings();
  const [selected, setSelected] = useState<string>('agents');
  const contentRef = useRef<HTMLDivElement>(null);
  const current = sections.find(section => section.id === selected)!;

  return (
    <AppPage width="lg" mainClassName="flex items-start gap-12 pt-10 max-md:flex-col max-md:gap-6">
      <aside className="sticky top-[calc(6.25rem+1px)] w-[190px] shrink-0 max-md:top-[calc(3.75rem+1px)] max-md:z-10 max-md:w-full max-md:bg-background max-md:py-3">
        <h2 className="mb-8 text-2xl font-semibold tracking-tight text-foreground max-md:mb-3">Settings</h2>
        <nav aria-label="Settings sections" className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">
          {desktop.state.available && sections.map(section => (
            <button key={section.id} type="button" aria-current={selected === section.id ? 'page' : undefined} aria-controls={`settings-${section.id}`} onClick={() => {
              setSelected(section.id);
              const page = contentRef.current?.closest('main')?.parentElement;
              if (page) page.scrollTop = 0;
            }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-[7px] border-none px-3 py-2.5 text-left text-[0.8125rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-muted-foreground ${selected === section.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
              <section.icon size={16} aria-hidden="true" className="shrink-0" />
              {section.label}
            </button>
          ))}
        </nav>
      </aside>
      <div ref={contentRef} role="region" aria-label="Settings content" className="min-w-0 w-full flex-1 pt-16 max-md:pt-0">
        <div className="mb-6">
          <h3 className="text-xl font-semibold tracking-tight text-foreground">{current.label}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{current.description}</p>
        </div>
        <div id={`settings-${selected}`}>
          {selected === 'agents' && <>
            <CliSection state={desktop.state} update={desktop.update} detect={desktop.detect} />
            <AgentDefaultsSection state={desktop.state} update={desktop.update} detect={desktop.detect} />
          </>}
          {selected === 'notifications' && <NotificationSettings {...desktop} />}
          {selected === 'appearance' && <AppearanceSettings {...desktop} />}
          {selected === 'storage' && <StorageSettings />}
        </div>
        {desktop.state.error && <p role="alert" className="mt-2 text-sm text-destructive">{desktop.state.error}</p>}
      </div>
    </AppPage>
  );
}
