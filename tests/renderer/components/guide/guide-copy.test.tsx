import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import GuideTroubleshooting from '@/components/guide/GuideTroubleshooting';
import GuideWorkspace from '@/components/guide/GuideWorkspace';
import GuideAgents from '@/components/guide/GuideAgents';
import GuideBlueprints from '@/components/guide/GuideBlueprints';
import GuideSetup from '@/components/guide/GuideSetup';
import GuidePullRequests from '@/components/guide/GuidePullRequests';
import GuideCapabilities from '@/components/guide/GuideCapabilities';

function show(page: ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe('desktop guide', () => {
  it('distinguishes conversation history from Git and uses real view names', () => {
    show(<GuideWorkspace />);
    expect(screen.queryByText('Workspace tour · select a view')).not.toBeInTheDocument();
    expect(screen.getByText(/Claude Code and Codex chats saved for this folder/)).toBeInTheDocument();
    expect(screen.queryByText('A useful review loop')).not.toBeInTheDocument();
    expect(screen.getByText(/permission and sandbox modes/)).toBeInTheDocument();
    expect(screen.getByText('Sources', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /view tabs/ })).toHaveAttribute('src', '/guide/workspace.png');
  });

  it('keeps grouped troubleshooting and links to the detailed explanations', () => {
    show(<GuideTroubleshooting />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText("My PDF didn't import")).toBeInTheDocument();
    expect(screen.getByText(/readable, unencrypted file/)).toBeInTheDocument();
    expect(screen.getByText('The build fails')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Changes' })).toHaveAttribute('href', '/guide/pull-requests');
    expect(screen.getByText('The agent pushed something I didn’t want')).toBeInTheDocument();
    expect(screen.getByText(/Desktop has no fixed session cap/)).toBeInTheDocument();
    expect(screen.getByText(/Fuse leaves changes uncommitted/)).toBeInTheDocument();
  });

  it('explains agent controls without stock prompts or invented workflows', () => {
    const { container } = show(<GuideAgents />);
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.queryByText(/clock-style/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Active sessions' })).toHaveAttribute('href', '/guide/workspace');
    expect(container.textContent).toContain('Effort sets how much reasoning');
    expect(screen.getByText(/permission modes/)).toBeInTheDocument();
    expect(container.textContent).toContain('sandbox');
    expect(container.textContent).not.toMatch(/composer|five-stage|doubling|A useful rhythm/);
    expect(screen.getByRole('heading', { name: 'Attach sources' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Lines 1–3 selected/ })).toHaveAttribute('src', '/guide/source-attachment.png');
  });

  it('uses parsed markers to show the completed example and copies real source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = show(<GuideBlueprints />);
    expect(screen.getByRole('heading', { name: 'Blueprints' })).toBeInTheDocument();
    expect(screen.getByText('Badges come from the LaTeX markers.')).toBeInTheDocument();
    const example = screen.getByRole('region', { name: 'Example blueprint' });
    const declarations = example.querySelectorAll('.doc-decl');
    expect(declarations).toHaveLength(2);
    expect(declarations[0].querySelector('.doc-decl-status')).toHaveTextContent('Formalized');
    expect(declarations[1].querySelector('.doc-decl-status')).toHaveTextContent('Proved');
    expect(example.querySelector('.katex')).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: 'Blueprint preview reveal' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '100');
    fireEvent.keyDown(slider, { key: 'Home' });
    const editors = container.querySelectorAll('.cm-content');
    expect(editors).toHaveLength(2);
    expect(editors[0]).toHaveTextContent('\\label{def:twice}');
    expect(editors[1]).toHaveTextContent('theorem twice_zero');
    expect(editors[1]).toHaveAttribute('contenteditable', 'false');
    fireEvent.click(within(example).getByRole('button', { name: 'Copy Blueprint · LaTeX' }));
    expect(await within(example).findByText('Copied')).toBeInTheDocument();
    expect(writeText.mock.calls[0][0]).toContain('\\begin{proof}\n\\leanok');
  });

  it('defines prerequisites and warns before an agent is started', () => {
    const { container } = show(<GuideSetup />);
    expect(screen.getByRole('heading', { name: 'Setup' })).toBeInTheDocument();
    expect(screen.getByText('Match Mathlib (recommended)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Before starting an agent' })).toBeInTheDocument();
    expect(container.textContent).toContain('Fuse leaves changes uncommitted');
    // The step list resets margins, so chapter spacing must use layout gaps.
    expect(container.querySelector('ol')?.parentElement).toHaveClass('flex', 'flex-col', 'gap-9');
    expect(screen.getByText('New workspace')).toBeInTheDocument();
    expect(screen.getByText('Select an existing blueprint')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lean learning resources' })).toHaveAttribute('href', 'https://lean-lang.org/learn/');
  });

  it('explains explicit commits and separate pushes', () => {
    const { container } = show(<GuidePullRequests />);
    expect(screen.getByRole('heading', { name: 'Changes' })).toBeInTheDocument();
    expect(container.textContent).toContain('Finishing a turn doesn’t trigger a commit or push');
    expect(container.textContent).toContain('The Changes tab is read-only');
    expect(container.textContent).toContain('Ask the agent to commit or push');
    expect(container.textContent).not.toContain('Eligible');
    expect(container.textContent).not.toMatch(/validation|activity timeout|additional allowed workspace paths/);
    expect(container.textContent).not.toContain('Auto-commit');
  });

  it('keeps the full unfinished-proof warning in What to trust', () => {
    show(<GuideCapabilities />);
    expect(screen.getByRole('heading', { name: 'What to trust' })).toBeInTheDocument();
    expect(screen.getByText(/Lean accepts/)).toHaveTextContent('sorry');
    expect(screen.getByText(/Refreshing the blueprint re-reads/)).toBeInTheDocument();
    expect(screen.queryByText('Good places to start')).not.toBeInTheDocument();
  });
});
