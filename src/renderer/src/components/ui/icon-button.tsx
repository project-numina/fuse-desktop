import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Square icon button primitive — a fixed-size button whose only content is a
// centered icon (close, send, stop, toolbar actions, pagination chevrons).
// default) into the studio token/cva idiom. Studio's `Button` covers most
// icon-only cases via `size="icon"`, but fuse leans on the circular accent
// send/stop affordance and the "plain" hover-to-accent icon, so this keeps that
// exact behavior available as a small standalone primitive.
const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center border border-transparent bg-clip-padding transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Solid accent fill — the chat send/stop affordance.
        accent:
          'bg-primary text-primary-foreground hover:bg-primary/80 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        // Transparent until hover — close buttons, toolbar actions.
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        // No background at all, just an icon that shifts to the accent color.
        plain: 'text-foreground hover:text-primary',
      },
      size: {
        sm: 'size-7',
        default: 'size-8',
        lg: 'size-9',
      },
      radius: {
        full: 'rounded-full',
        md: 'rounded-lg',
        sm: 'rounded-md',
      },
    },
    defaultVariants: {
      variant: 'accent',
      size: 'default',
      radius: 'full',
    },
  }
);

function IconButton({
  className,
  variant = 'accent',
  size = 'default',
  radius = 'full',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof iconButtonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, size, radius, className }))}
      {...props}
    />
  );
}

export { IconButton, iconButtonVariants };
