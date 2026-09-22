import { cn } from '@/lib/utils';

import { SETTINGS_SECTIONS, type SettingsSection } from './helpers';

interface SettingsNavigationProps {
  section: SettingsSection;
  onChange: (section: SettingsSection) => void;
}

export function SettingsNavigation({ section, onChange }: SettingsNavigationProps) {
  return (
    <nav
      aria-label="Workspace settings sections"
      className="flex w-full shrink-0 flex-wrap gap-1 @min-[640px]:w-40 @min-[640px]:flex-col"
    >
      {SETTINGS_SECTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={section === item.id ? 'page' : undefined}
          aria-controls={`workspace-settings-${item.id}`}
          onClick={() => onChange(item.id)}
          className={cn(
            'cursor-pointer rounded-[7px] border-none px-3 py-2.5 text-left text-[0.8125rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-muted-foreground',
            section === item.id
              ? 'bg-muted text-foreground'
              : 'bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
