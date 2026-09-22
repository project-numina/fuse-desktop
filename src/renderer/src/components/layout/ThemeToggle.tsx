import { useTheme, type ThemePreference } from '@/state/theme';
import HeaderIcon from './HeaderIcon';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { headerControlClass } from './header-control';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const themes: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger render={<TooltipTrigger />} className={headerControlClass} aria-label="Appearance">
          <HeaderIcon name={theme} />
        </DropdownMenuTrigger>
        <TooltipContent>Appearance</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} className="w-48 rounded-[10px] border border-border bg-card p-1.5 shadow-[var(--shadow-lg)] ring-0">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-1.5 pb-2 text-[0.6875rem] font-medium">Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
            {themes.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick className="cursor-pointer gap-3 rounded-[6px] py-2.5 pl-2.5 pr-8 hover:bg-muted data-highlighted:bg-muted data-checked:bg-muted/60">
                <HeaderIcon name={option.value} />
                <span>{option.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
