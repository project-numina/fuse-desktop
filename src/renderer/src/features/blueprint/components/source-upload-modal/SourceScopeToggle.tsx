import { Switch } from '@/components/ui/switch';

interface SourceScopeToggleProps {
  blueprintId: string;
  projectScoped: boolean;
  onChange: (checked: boolean) => void;
}

export function SourceScopeToggle(props: SourceScopeToggleProps) {
  if (!props.blueprintId) return null;
  return (
    <label className="mt-4 flex cursor-pointer items-center gap-3">
      <Switch
        checked={props.projectScoped}
        onCheckedChange={props.onChange}
        aria-label="Workspace only"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Workspace only</span>
        <span className="text-xs leading-snug text-muted-foreground">
          Turn off to use this source in all your workspaces in this repository.
        </span>
      </span>
    </label>
  );
}
