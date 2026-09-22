import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

describe('UI primitives', () => {
  it('composes avatar and card slots with semantic content', () => {
    render(
      <Card size="sm">
        <CardHeader><CardTitle>Project</CardTitle><CardDescription>Details</CardDescription></CardHeader>
        <CardContent>
          <AvatarGroup>
            <Avatar size="sm"><AvatarFallback>NA</AvatarFallback><AvatarBadge /></Avatar>
            <AvatarGroupCount>+2</AvatarGroupCount>
          </AvatarGroup>
        </CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
    expect(screen.getByText('+2')).toHaveAttribute('data-slot', 'avatar-group-count');
    expect(screen.getByText('Footer')).toHaveAttribute('data-slot', 'card-footer');
  });

  it('renders separator orientation and changes required segmented selection', () => {
    const onValueChange = vi.fn();
    render(
      <>
        <Separator orientation="vertical" />
        <SegmentedControl
          value="one"
          onValueChange={onValueChange}
          options={[{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }]}
        />
      </>,
    );
    expect(document.querySelector('[data-slot="separator"]')).toHaveAttribute('data-orientation', 'vertical');
    fireEvent.click(screen.getByText('Two'));
    expect(onValueChange).toHaveBeenCalledWith('two');
  });

  it('changes shared select and switch values through accessible controls', () => {
    const onSelect = vi.fn();
    const onSwitch = vi.fn();
    render(
      <>
        <Select
          value="one"
          onValueChange={onSelect}
          options={[{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }]}
          ariaLabel="Example"
        />
        <Switch checked={false} onCheckedChange={onSwitch} aria-label="Enabled" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Example: One' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Two' }));
    expect(onSelect).toHaveBeenCalledWith('two');
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
    expect(onSwitch).toHaveBeenCalledWith(true, expect.anything());
    expect(document.querySelector('[data-slot="switch-thumb"]')).toHaveClass('pointer-events-none');
  });

  it('keeps a disabled switch as the pointer hit target', () => {
    render(<Switch checked={false} disabled aria-label="Saving" />);
    const control = screen.getByRole('switch', { name: 'Saving' });
    expect(control).toHaveAttribute('data-disabled');
    expect(control).not.toHaveClass('pointer-events-none');
    expect(control).toHaveClass('cursor-pointer');
  });

  it('reports a scalar from the slider and labels its stops', () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        value={1}
        onValueChange={onValueChange}
        max={4}
        ariaLabel="Parallel agents"
        tickLabels={['1', '2', '3', '4']}
      />,
    );
    // Base UI keeps a visually hidden range input inside the styled thumb, so
    // the control stays natively accessible while the visuals are ours.
    const input = screen.getByRole('slider', { name: 'Parallel agents' });
    expect(input).toHaveAttribute('max', '4');
    expect(input).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('3')).toBeInTheDocument();

    // Assert the callback receives a number, not the array range mode emits.
    fireEvent.change(input, { target: { value: '3' } });
    expect(onValueChange).toHaveBeenCalledWith(3);
  });
});
