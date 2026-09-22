import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Single-select control rendered either as a segmented button group
// `BaseSegmentedControl` onto Base UI's Toggle Group, expressed with studio
// tokens. Controlled via `value` / `onValueChange` (React's v-model equivalent).
const segmentedControlVariants = cva('inline-flex', {
  variants: {
    variant: {
      segmented: 'overflow-hidden rounded-lg border border-border',
      underline: 'border-b border-border',
    },
  },
  defaultVariants: {
    variant: 'segmented',
  },
});

const segmentedItemVariants = cva(
  'inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        segmented:
          'px-2.5 py-1 text-xs text-foreground not-data-[pressed]:hover:bg-muted data-[pressed]:bg-primary data-[pressed]:font-semibold data-[pressed]:text-primary-foreground [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border',
        underline:
          '-mb-px border-b-2 border-transparent px-4 py-2 text-[0.8125rem] font-semibold text-foreground hover:text-foreground data-[pressed]:border-primary data-[pressed]:text-foreground',
      },
    },
    defaultVariants: {
      variant: 'segmented',
    },
  }
);

interface SegmentedControlOption {
  label: string
  value: string
}

interface SegmentedControlProps
  extends VariantProps<typeof segmentedControlVariants> {
  options: SegmentedControlOption[]
  value: string
  onValueChange: (value: string) => void
  className?: string
  disabled?: boolean
}

function SegmentedControl({
  options,
  value,
  onValueChange,
  variant = 'segmented',
  className,
  disabled,
}: SegmentedControlProps) {
  return (
    <ToggleGroup
      data-slot="segmented-control"
      value={[value]}
      onValueChange={(groupValue) => {
        const next = groupValue[0];
        // Selection is required: ignore attempts to toggle the active item off.
        if (next !== undefined) onValueChange(next);
      }}
      disabled={disabled}
      role={variant === 'underline' ? 'tablist' : 'group'}
      className={cn(segmentedControlVariants({ variant }), className)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          data-slot="segmented-control-item"
          className={cn(segmentedItemVariants({ variant }))}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export { SegmentedControl, segmentedControlVariants, segmentedItemVariants };
export type { SegmentedControlOption, SegmentedControlProps };
