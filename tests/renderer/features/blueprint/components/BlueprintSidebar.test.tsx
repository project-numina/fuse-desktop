import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BlueprintSidebar from '@/features/blueprint/components/BlueprintSidebar';
vi.mock('@/hooks/use-session-attention', () => ({ useSessionAttention: () => [
  { id: 'a', owner: 'owner', repository: 'repo', blueprint: 'one', unread: true },
  { id: 'b', owner: 'owner', repository: 'repo', blueprint: 'two', unread: true },
  { id: 'c', owner: 'owner', repository: 'repo', blueprint: 'one', unread: false },
] }));

describe('BlueprintSidebar', () => {
  it('places setup immediately below Settings instead of pinning it to the bottom', () => {
    render(<BlueprintSidebar mode="view" onModeChange={vi.fn()} footer={<button>Set up Lean</button>} />);
    const footer = screen.getByRole('button', { name: 'Set up Lean' }).parentElement!;
    expect(footer).not.toHaveClass('pt-3');
    expect(footer).not.toHaveClass('mt-auto');
    expect(footer.previousElementSibling).toHaveTextContent('Settings');
  });
  it('counts only unread chats in this workspace', () => {
    render(<BlueprintSidebar owner="owner" repository="repo" blueprintId="one" mode="history" onModeChange={vi.fn()} />);
    expect(screen.getByLabelText('1 unread chats')).toBeInTheDocument();
    expect(screen.getByLabelText('1 unread chats')).toHaveClass('ml-auto', 'text-muted-foreground');
    expect(screen.getByLabelText('1 unread chats')).not.toHaveClass('rounded-full', 'bg-primary/10');
    expect(screen.queryByLabelText('2 unread chats')).not.toBeInTheDocument();
  });
  it('renders all private workspace modes and reports mode changes', () => {
    const onModeChange = vi.fn();
    render(<BlueprintSidebar mode="home" onModeChange={onModeChange} />);
    for (const name of ['Overview', 'Blueprint', 'Graph', 'Files', 'History', 'Changes', 'Settings']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lean' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Files/ }));
    expect(onModeChange).toHaveBeenCalledWith('view');
  });

  it('marks the active mode and starts a new chat', () => {
    const onNewChat = vi.fn();
    render(<BlueprintSidebar mode="edit" onModeChange={vi.fn()} onNewChat={onNewChat} />);
    expect(screen.getByRole('button', { name: 'Blueprint' })).toHaveClass(
      'bg-[var(--accent-overlay-soft)]',
    );
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it('hides private actions and the build status on a public share', () => {
    render(<BlueprintSidebar mode="home" publicShare onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Lean build status/)).not.toBeInTheDocument();
    for (const name of ['New chat', 'History', 'Changes', 'Settings']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('hides New chat for merged workspaces but keeps history controls', () => {
    render(<BlueprintSidebar mode="history" readonly onModeChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('shows OCR state only for active or failed PDF scans', () => {
    const { rerender } = render(
      <BlueprintSidebar mode="source" sourceType="pdf" ocrStatus="scanning" onModeChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('OCR status: Scanning…')).toBeInTheDocument();
    rerender(
      <BlueprintSidebar mode="source" sourceType="pdf" ocrStatus="complete" onModeChange={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/OCR status/)).not.toBeInTheDocument();
    rerender(
      <BlueprintSidebar mode="source" sourceType="latex" ocrStatus="failed" onModeChange={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/OCR status/)).not.toBeInTheDocument();
  });

  it('renders Lean without the obsolete build-status dot in private workspaces', () => {
    render(<BlueprintSidebar mode="view" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Lean build status/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Files' }).querySelector('.rounded-full')).toBeNull();
  });
});
