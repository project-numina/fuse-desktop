import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function ExampleTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger delay={0}>Details</TooltipTrigger>
      <TooltipContent className="custom-tooltip">More information</TooltipContent>
    </Tooltip>
  );
}

describe('Tooltip', () => {
  it('opens for keyboard focus and closes with Escape', async () => {
    render(
      <TooltipProvider>
        <ExampleTooltip />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.focus(trigger);
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
      expect(content).toBeInTheDocument();
      return content as HTMLElement;
    });
    expect(tooltip).toHaveTextContent('More information');
    expect(tooltip).toHaveAttribute('data-slot', 'tooltip-content');
    expect(tooltip).toHaveClass('custom-tooltip');
    expect(trigger).toHaveAttribute('data-popup-open');

    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument();
    });
  });

  it('reports pointer-driven open and close changes', async () => {
    const onOpenChange = vi.fn();
    render(
      <TooltipProvider delay={0}>
        <Tooltip onOpenChange={onOpenChange}>
          <TooltipTrigger>Inspect</TooltipTrigger>
          <TooltipContent side="right" align="start" sideOffset={10}>
            Inspection details
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Inspect' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]'))
        .toHaveTextContent('Inspection details');
    });
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());

    fireEvent.mouseLeave(trigger);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
