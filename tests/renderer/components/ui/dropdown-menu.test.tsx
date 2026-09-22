import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function FullMenu({
  onOpenChange,
  onRename,
  onCheckedChange,
  onValueChange,
}: {
  onOpenChange?: (open: boolean) => void;
  onRename?: () => void;
  onCheckedChange?: (checked: boolean) => void;
  onValueChange?: (value: string) => void;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label="Project actions">Open</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <span data-testid="portal-child">Portaled</span>
      </DropdownMenuPortal>
      <DropdownMenuContent className="custom-popup">
        <DropdownMenuGroup>
          <DropdownMenuLabel inset>Project</DropdownMenuLabel>
          <DropdownMenuItem onClick={onRename} inset>
            Rename
            <DropdownMenuShortcut>R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            defaultChecked
            onCheckedChange={onCheckedChange}
            closeOnClick={false}
          >
            Show hidden files
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="list" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="grid" inset>Grid</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="custom-separator" />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>Export</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="custom-submenu">
            <DropdownMenuItem>PDF</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DropdownMenu', () => {
  it('opens with the keyboard, exposes item state, and closes with Escape', async () => {
    const onOpenChange = vi.fn();
    render(<FullMenu onOpenChange={onOpenChange} />);

    const trigger = screen.getByRole('button', { name: 'Project actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const rename = (await screen.findByText('Rename')).closest('[role="menuitem"]');
    expect(rename).not.toBeNull();
    expect(rename).toHaveAttribute('data-highlighted');
    expect(screen.getByTestId('portal-child')).toBeInTheDocument();
    expect(screen.getByText('Project')).toHaveAttribute('data-inset', 'true');
    expect(screen.getByRole('menu')).toHaveClass('custom-popup');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show hidden files' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'List' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitem', { name: 'Delete' }))
      .toHaveAttribute('data-variant', 'destructive');

    fireEvent.keyDown(rename as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('reports checkbox and radio changes without closing their menu', async () => {
    const onCheckedChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <FullMenu
        onCheckedChange={onCheckedChange}
        onValueChange={onValueChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));

    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Show hidden files' }));
    expect(onCheckedChange).toHaveBeenCalledWith(false, expect.anything());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Grid' }));
    expect(onValueChange).toHaveBeenCalledWith('grid', expect.anything());
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('selects a regular item and closes the menu', async () => {
    const onRename = vi.fn();
    render(<FullMenu onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    const rename = (await screen.findByText('Rename')).closest('[role="menuitem"]');
    expect(rename).not.toBeNull();
    fireEvent.click(rename as HTMLElement);

    expect(onRename).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('opens a submenu with the keyboard', async () => {
    render(<FullMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    const exportItem = await screen.findByRole('menuitem', { name: 'Export' });

    exportItem.focus();
    fireEvent.keyDown(exportItem, { key: 'ArrowRight' });

    expect(await screen.findByRole('menuitem', { name: 'PDF' })).toBeVisible();
    expect(screen.getAllByRole('menu')).toHaveLength(2);
    expect(screen.getAllByRole('menu')[1]).toHaveClass('custom-submenu');
  });
});
