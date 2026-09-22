import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const switchVariants = cva(
  'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted p-0.5 transition-colors outline-none data-checked:border-primary data-checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'h-4 w-7',
        default: 'h-5 w-9',
        lg: 'h-[22px] w-10',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-white shadow-sm transition-transform',
  {
    variants: {
      size: {
        sm: 'size-3 data-checked:translate-x-3',
        default: 'size-4 data-checked:translate-x-4',
        lg: 'size-4 data-checked:translate-x-[18px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & VariantProps<typeof switchVariants>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchVariants({ size }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={switchThumbVariants({ size })}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch, switchVariants };
