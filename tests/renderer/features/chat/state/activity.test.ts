import { describe, expect, it } from 'vitest';

import { displayPath, formatToolActivity, isBackgroundLogWrite, isMetadataPath } from '@/features/chat/state/activity';
import type { ToolHistoryEvent } from '@/features/chat/state/types';

describe('chat activity formatting', () => {
  it('recognizes internal metadata paths without hiding ordinary sources', () => {
    expect(isMetadataPath('foo/.metadata/cache.json')).toBe(true);
    expect(isMetadataPath('foo/declarations/Bar.json')).toBe(true);
    expect(isMetadataPath('repo/blueprint.json')).toBe(true);
    expect(isMetadataPath('Foo/Bar.lean')).toBe(false);
    expect(isMetadataPath('declarations/notes.tex')).toBe(false);
  });

  it('reduces paths to their filename', () => {
    expect(displayPath('/tmp/a/Foo.lean')).toBe('Foo.lean');
    expect(displayPath('Foo.lean')).toBe('Foo.lean');
    expect(displayPath('')).toBe('');
  });

  it.each([
    ['Read', { file_path: '/tmp/Foo.lean' }, 'Read', 'Foo.lean'],
    ['MultiEdit', { path: '/tmp/Foo.lean' }, 'Edit', 'Foo.lean'],
    ['Glob', { pattern: '**/*.lean' }, 'Glob', '**/*.lean'],
    ['Grep', { pattern: 'theorem' }, 'Grep', 'theorem'],
    ['Task', { description: 'Split blueprint' }, 'Agent', 'Split blueprint'],
  ])('formats %s calls', (tool, input, expectedTool, summary) => {
    expect(formatToolActivity(tool, input)).toMatchObject({ tool: expectedTool, summary });
  });

  it('truncates long commands and hides metadata commands', () => {
    const result = formatToolActivity('Bash', { command: `echo ${'a'.repeat(200)}` });
    expect(result.summary).toHaveLength(83);
    expect(result.summary).toMatch(/\.\.\.$/);
    expect(formatToolActivity('Bash', { command: 'ls .metadata/' }).hidden).toBe(true);
  });

  it.each([
    ['mcp__report-misuse__report', 'report-misuse', true],
    ['mcp__prover-tools__run', 'prover-tools', true],
    ['mcp__authoring-tools__formalize', 'authoring-tools', true],
    ['ToolSearch', 'ToolSearch', true],
    ['mcp__lean-explore__search', 'lean-explore', false],
    ['mcp__lean-lsp__diagnostics', 'lean-lsp', false],
    ['mcp__blueprint-tools__edit', 'blueprint-tools', false],
    ['mcp__build-tools__build', 'build-tools', false],
    ['mcp__pdf-tools__read', 'pdf-tools', false],
    ['mcp__source-tools__ocr', 'source-tools', false],
    ['mcp__leanstral__prove', 'leanstral', false],
    ['mcp__orchestration-tools__delegate_tasks', 'orchestration-tools', false],
    ['mcp__future-tools__new_action', 'future-tools', false],
  ])('normalizes %s', (raw, tool, hidden) => {
    expect(formatToolActivity(raw, {})).toMatchObject({ tool, hidden });
  });

  it('shows the MCP action separately from its normalized server name', () => {
    expect(formatToolActivity('mcp__orchestration-tools__delegate_tasks', {})).toMatchObject({
      tool: 'orchestration-tools',
      summary: 'delegate_tasks',
    });
  });

  it.each([
    ['mcp__prover-tools__run_provers', 'prover-tools', 'run_provers'],
    ['mcp__authoring-tools__formalize', 'authoring-tools', 'formalize'],
    ['mcp__authoring-tools__draft_blueprint', 'authoring-tools', 'draft_blueprint'],
  ])(
    'shows delegated workflow %s as one ordinary subagent tool call',
    (raw, tool, summary) => {
      expect(
        formatToolActivity(raw, {}, { insideSubagent: true }),
      ).toMatchObject({ tool, summary, hidden: false });
    },
  );

  it('detects only write-like background log events', () => {
    const event = (tool: string, path: string): ToolHistoryEvent => ({
      kind: 'tool_call', tool, input: { file_path: path },
    });
    expect(isBackgroundLogWrite(event('Write', 'x/background-log.md'))).toBe(true);
    expect(isBackgroundLogWrite(event('Edit', '/background-log.md'))).toBe(true);
    expect(isBackgroundLogWrite(event('Read', 'x/background-log.md'))).toBe(false);
    expect(isBackgroundLogWrite(event('Write', 'x/notes.md'))).toBe(false);
  });
});
