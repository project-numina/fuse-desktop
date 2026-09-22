import { Slider as SliderPrimitive } from '@base-ui/react/slider';

import { cn } from '@/lib/utils';

interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max: number
  step?: number
  ariaLabel: string
  /** Labels rendered under the track, one per stop. Omit to hide the scale. */
  tickLabels?: string[]
  className?: string
  disabled?: boolean
}

/**
 * Flat single-value slider expressed with the shared border/primary tokens.
 *
 * Built on Base UI rather than `<input type="range">` so the track and thumb
 * are ours to style — a native range renders with the browser's own shading
 * and rounding, which reads as a foreign control next to the other primitives.
 */
function Slider({
  value,
  onValueChange,
  min = 1,
  max,
  step = 1,
  ariaLabel,
  tickLabels,
  className,
  disabled,
}: SliderProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <SliderPrimitive.Root
        data-slot="slider"
        value={value}
        onValueChange={(next) => {
          // Base UI widens the value to an array for range sliders; this is a
          // single-thumb slider, so collapse it back to a scalar.
          onValueChange(Array.isArray(next) ? next[0] : next);
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      >
        <SliderPrimitive.Control className="flex h-5 w-full cursor-pointer items-center data-disabled:pointer-events-none data-disabled:opacity-50">
          <SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-muted">
            <SliderPrimitive.Indicator className="rounded-full bg-primary" />
            <SliderPrimitive.Thumb
              aria-label={ariaLabel}
              className="size-4 rounded-full border border-primary bg-card outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </SliderPrimitive.Track>
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
      {tickLabels && (
        <div
          className="flex justify-between text-xs text-muted-foreground"
          aria-hidden="true"
        >
          {tickLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export { Slider };
export type { SliderProps };
