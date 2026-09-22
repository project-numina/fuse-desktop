import type { ComponentProps, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('@/components/layout/AppHeader', () => ({
  default: ({ breadcrumbs, loading }: { breadcrumbs: ReactNode; loading: boolean }) => (
    <header data-loading={String(loading)}>{breadcrumbs}</header>
  ),
}));
vi.mock('@/components/MathText', () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock('@/desktop/LeanSetupPrompt', () => ({ default: () => <span>Lean setup</span> }));
vi.mock('@/features/chat/components/panel/ChatPanel', () => ({ default: () => <div>Chat panel</div> }));
vi.mock('@/features/blueprint/components/BlueprintSidebar', () => ({ default: () => <aside>Sidebar</aside> }));
vi.mock('@/features/blueprint/components/SectionSelector', () => ({ default: () => <div>Sections</div> }));
vi.mock('@/features/blueprint/components/BlueprintEmptyState', () => ({ default: () => <div>Empty editor</div> }));
vi.mock('@/features/blueprint/components/HomeMode', () => ({ default: () => <div>Home mode</div> }));
vi.mock('@/features/blueprint/components/GraphMode', () => ({ default: () => <div>Graph mode</div> }));
vi.mock('@/features/blueprint/components/EditMode', () => ({ default: () => <div>Edit mode</div> }));
vi.mock('@/features/blueprint/components/LeanView', () => ({ default: () => <div>Lean view</div> }));
vi.mock('@/features/blueprint/components/GitMode', () => ({ default: () => <div>Git mode</div> }));
vi.mock('@/features/blueprint/components/HistoryMode', () => ({ default: () => <div>History mode</div> }));
vi.mock('@/features/blueprint/components/SettingsMode', () => ({ default: () => <div>Settings mode</div> }));

import BlueprintWorkspaceView from '@/features/blueprint/page/BlueprintWorkspaceView';

function props(overrides: Partial<ComponentProps<typeof BlueprintWorkspaceView>> = {}) {
  return {
    route: { owner: 'acme', repo: 'mathlib', blueprintId: 'fermat' },
    blueprint: { id: 'fermat', name: 'Fermat', blueprint_file: 'blueprint.tex', can_edit: true },
    blueprintLabel: 'Fermat',
    loading: false,
    error: null,
    canEdit: true,
    mode: 'home',
    mountedModes: new Set(['home']),
    projectDirectory: 'Project',
    sidebarOcrStatus: 'not_started',
    onModeChange: vi.fn(),
    onNewChat: vi.fn(),
    chatProps: {},
    homeProps: {},
    graphProps: {},
    emptyProps: {},
    editProps: {},
    gitProps: {},
    historyProps: {},
    settingsProps: {},
    leanProps: {},
    showSectionSelector: false,
    sectionProps: {},
    ...overrides,
  } as unknown as ComponentProps<typeof BlueprintWorkspaceView>;
}

describe('BlueprintWorkspaceView', () => {
  it('prioritizes the error and loading states over workspace chrome', () => {
    const { rerender } = render(<BlueprintWorkspaceView {...props({ error: 'Not found' })} />);
    expect(screen.getByText('Not found')).toBeVisible();
    expect(screen.queryByText('Sidebar')).not.toBeInTheDocument();

    rerender(<BlueprintWorkspaceView {...props({ blueprint: null, loading: true })} />);
    expect(screen.getByText('Loading blueprint…')).toBeVisible();
    expect(screen.getByRole('banner')).toHaveAttribute('data-loading', 'true');
  });

  it('renders common chrome, the active home mode, and chapter selection', () => {
    render(<BlueprintWorkspaceView {...props({ showSectionSelector: true })} />);

    expect(screen.getByText('Sidebar')).toBeVisible();
    expect(screen.getByText('Chat panel')).toBeVisible();
    expect(screen.getByText('Home mode')).toBeVisible();
    expect(screen.getByText('Sections')).toBeVisible();
    expect(screen.getByRole('link', { name: 'mathlib' })).toHaveAttribute('href', '/repo/acme/mathlib');
  });

  it('shows the read-only badge and empty editor when no blueprint file exists', () => {
    render(<BlueprintWorkspaceView {...props({
      blueprint: { id: 'fermat', can_edit: false },
      canEdit: false,
      mode: 'edit',
      mountedModes: new Set(['home', 'edit']),
    })} />);

    expect(screen.getByText('Read-only')).toHaveAttribute('title', 'This workspace is read-only.');
    expect(screen.getByText('Empty editor')).toBeVisible();
    expect(screen.queryByText('Edit mode')).not.toBeInTheDocument();
  });
});
