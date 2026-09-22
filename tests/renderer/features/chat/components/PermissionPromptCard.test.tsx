import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PermissionPrompt } from '@/features/chat/state/types';

import PermissionPromptCard, { summarizePermissionInput } from '@/features/chat/components/PermissionPromptCard';

function prompt(overrides: Partial<PermissionPrompt> = {}): PermissionPrompt {
  return {
    request_id: 'perm-1',
    tool: 'Bash',
    input: { command: 'lake build' },
    description: null,
    reason: null,
    suggestions: [],
    tool_use_id: 'tool-1',
    assistant_turn_id: null,
    anchorTurnId: 'turn-0',
    anchorAfterMessageCount: 0,
    order: 1,
    ...overrides,
  };
}

describe('summarizePermissionInput', () => {
  it('prefers the command for Bash and a path for file tools', () => {
    expect(summarizePermissionInput('Bash', { command: 'rm -rf build', description: 'x' }))
      .toBe('rm -rf build');
    expect(summarizePermissionInput('Edit', { file_path: 'Sample/Basic.lean', old_string: 'a' }))
      .toBe('Sample/Basic.lean');
    expect(summarizePermissionInput('WebFetch', { url: 'https://example.com' }))
      .toBe('https://example.com');
  });

  it('falls back to compact JSON and truncates long values', () => {
    expect(summarizePermissionInput('mcp__fuse__thing', { a: 1, b: 'two' }))
      .toBe('{ "a": 1, "b": "two" }');
    expect(summarizePermissionInput('Tool', {})).toBe('');
    const long = summarizePermissionInput('Bash', { command: 'x'.repeat(700) });
    expect(long.length).toBeLessThan(700);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('PermissionPromptCard', () => {
  it('lets users inspect the complete command and keeps technical reasons in a disclosure', () => {
    const command = `echo ${'long input '.repeat(100)} && important-final-command`;
    render(<PermissionPromptCard prompt={prompt({ input: { command }, reason: 'Contains simple_expansion' })} onRespond={vi.fn()} />);
    expect(screen.queryByText(/important-final-command/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show full input' }));
    expect(screen.getByText(/important-final-command/)).toBeVisible();
    expect(screen.getByText(/important-final-command/).textContent).toBe(command);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Contains simple_expansion').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText(/important-final-command/)).not.toBeInTheDocument();
  });

  it('renders the tool, preview, reason and every suggestion', () => {
    render(
      <PermissionPromptCard
        prompt={prompt({
          description: 'Run the build',
          reason: 'Not on the allow list',
          suggestions: [
            { label: 'Always allow lake build', payload: { rule: 'a' } },
            { label: 'Allow for this session', payload: { rule: 'b' } },
          ],
        })}
        onRespond={vi.fn()}
      />,
    );
    const card = screen.getByRole('group', { name: 'Permission request: Bash' });
    expect(card).toHaveTextContent('Run this command?');
    expect(card).toHaveTextContent('Run the build');
    expect(card).toHaveTextContent('Not on the allow list');
    expect(card).toHaveTextContent('lake build');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Always allow lake build' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Allow for this session' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('reports the chosen decision once and latches the buttons', () => {
    const onRespond = vi.fn();
    render(
      <PermissionPromptCard
        prompt={prompt({ suggestions: [{ label: 'Always', payload: 'always' }] })}
        onRespond={onRespond}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Always' }));
    expect(onRespond).toHaveBeenCalledWith('perm-1', { behavior: 'allow', suggestion: 'always' });
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onRespond).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Always' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });

  it('sends deny without a suggestion', () => {
    const onRespond = vi.fn();
    render(<PermissionPromptCard prompt={prompt()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onRespond).toHaveBeenCalledWith('perm-1', { behavior: 'deny' });
  });
});
