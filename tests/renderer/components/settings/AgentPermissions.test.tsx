import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_DEFAULTS, type AgentDefaults } from '@shared/desktop';
import type { ProviderId } from '@shared/agent-events';
import { AgentPermissions } from '@/components/settings/AgentPermissions';

const cases = [
  { provider: 'claude' as ProviderId, label: 'Claude Code permissions', dangerous: 'Bypass permissions (dangerous)', confirm: 'Enable bypass permissions', patch: { claude_permission_mode: 'bypassPermissions' }, safe: 'Plan only (no edits)', flag: '--dangerously-skip-permissions' },
  { provider: 'codex' as ProviderId, label: 'Codex sandbox', dangerous: 'Full access (dangerous)', confirm: 'Enable full access', patch: { codex_sandbox: 'danger-full-access' }, safe: 'Read only', flag: '--dangerously-bypass-approvals-and-sandbox' },
] as const;

it('offers Claude standard approvals without promising that already-allowed tools will prompt', async () => {
  const save = vi.fn();
  render(<AgentPermissions provider="claude" config={{ ...DEFAULT_AGENT_DEFAULTS, claude_permission_mode: 'manual' }}
    onChange={save} scope="defaults" />);
  expect(screen.getByRole('button', { name: 'Claude Code permissions: Standard approvals' })).toBeVisible();
  expect(screen.getByText(/Existing CLI rules still apply/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Claude Code permissions: Standard approvals' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ask for commands, allow file edits' }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ claude_permission_mode: 'acceptEdits' }));
});

describe.each(cases)('$provider permissions', testCase => {
  function choose(option: string) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${testCase.label}:`) }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
  }

  it('requires explicit confirmation before saving dangerous defaults and supports cancellation', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<AgentPermissions provider={testCase.provider} config={DEFAULT_AGENT_DEFAULTS} onChange={save} scope="defaults" />);
    choose(testCase.dangerous);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(testCase.flag);
    expect(dialog).toHaveTextContent('outside the repository');
    expect(dialog).toHaveTextContent('new workspaces only');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(save).not.toHaveBeenCalled();
    choose(testCase.dangerous);
    fireEvent.click(screen.getByRole('button', { name: testCase.confirm }));
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(testCase.patch));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('keeps a warning for saved dangerous modes and lets the user restore protection without confirmation', async () => {
    const save = vi.fn();
    function Harness() {
      const [config, setConfig] = useState<AgentDefaults>({ ...DEFAULT_AGENT_DEFAULTS, ...testCase.patch });
      return <AgentPermissions provider={testCase.provider} config={config} scope="defaults" onChange={patch => {
        save(patch); setConfig(previous => ({ ...previous, ...patch }));
      }} />;
    }
    render(<Harness />);
    expect(screen.getByRole('note')).toHaveTextContent('outside the repository');
    choose(testCase.safe);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('keeps confirmation open when saving fails and permits retry', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<AgentPermissions provider={testCase.provider} config={DEFAULT_AGENT_DEFAULTS} onChange={save} scope="defaults" />);
    choose(testCase.dangerous);
    fireEvent.click(screen.getByRole('button', { name: testCase.confirm }));
    await waitFor(() => expect(screen.getByRole('button', { name: testCase.confirm })).toBeEnabled());
    expect(screen.getByRole('alertdialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: testCase.confirm }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('disables editing for read-only settings', () => {
    render(<AgentPermissions provider={testCase.provider} config={DEFAULT_AGENT_DEFAULTS} onChange={vi.fn()} scope="defaults" disabled />);
    expect(screen.getByRole('button', { name: new RegExp(`^${testCase.label}:`) })).toBeDisabled();
  });
});
