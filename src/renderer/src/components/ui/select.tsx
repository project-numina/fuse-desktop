import { ChevronDownIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface SelectOption<Value extends string = string> {
  value: Value
  label: string
  description?: string
  disabled?: boolean
}

interface SelectProps<Value extends string = string> {
  id?: string
  value: Value
  onValueChange: (value: Value) => void
  options: readonly SelectOption<Value>[]
  ariaLabel: string
  className?: string
  contentClassName?: string
  itemClassName?: string
  disabled?: boolean
}

/** Compact single-value picker backed by Base UI's accessible menu primitives. */
function Select<Value extends string>({
  id,
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  contentClassName,
  itemClassName,
  disabled = false,
}: SelectProps<Value>) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        aria-label={`${ariaLabel}: ${selectedLabel}`}
        disabled={disabled}
        className={cn(
          'inline-flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors outline-none hover:border-foreground/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={8}
        className={cn('min-w-(--anchor-width) rounded-md p-0', contentClassName)}
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onValueChange(nextValue as Value)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              // The description sits flush under the label, so the two are
              // otherwise announced as one run ("CodexNot selectable yet").
              aria-label={
                option.description
                  ? `${option.label}, ${option.description}`
                  : undefined
              }
              closeOnClick
              className={cn('cursor-pointer rounded-none px-3.5 py-2', itemClassName)}
            >
              {option.description ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              ) : (
                option.label
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { Select };
export type { SelectProps };
