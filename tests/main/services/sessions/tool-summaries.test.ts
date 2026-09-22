import { describe, expect, it } from 'vitest';
import { countDisplayLines, summarizeToolInput, summarizeToolResult } from '@main/services/sessions/tool-summaries';

describe('summarizeToolInput', () => {
  it('keeps full line counts for a truncated Write body', () => {
    const content = Array.from({ length: 309 }, (_, index) => `theorem line_${index} : True := by trivial\n`).join('');
    const summary = summarizeToolInput('Write', { file_path: 'LeanEvalBenchmark/Pi10fTheCircleIsZ/Basic.lean', content });
    expect(String(summary.content).endsWith('...')).toBe(true);
    expect(summary._fuse_display).toEqual({ line_counts: { content: 309 } });
  });

  it('keeps full line counts for truncated Edit strings', () => {
    const oldString = Array.from({ length: 211 }, (_, index) => `theorem old_line_${index} : True := by trivial\n`).join('');
    const newString = Array.from({ length: 307 }, (_, index) => `theorem new_line_${index} : True := by trivial\n`).join('');
    const summary = summarizeToolInput('Edit', { file_path: 'Proof.lean', old_string: oldString, new_string: newString });
    expect(String(summary.old_string).endsWith('...')).toBe(true);
    expect(String(summary.new_string).endsWith('...')).toBe(true);
    expect(summary._fuse_display).toEqual({ line_counts: { old_string: 211, new_string: 307 } });
  });

  it('truncates long paths from the front so the basename survives', () => {
    const path = `/very/long/${'deep/'.repeat(60)}Basic.lean`;
    const truncated = String(summarizeToolInput('Read', { file_path: path }).file_path);
    expect(truncated.startsWith('...')).toBe(true);
    expect(truncated.split('/').pop()).toBe('Basic.lean');
  });

  it('leaves short paths and non-string values alone', () => {
    const summary = summarizeToolInput('Read', { file_path: 'LeanEvalBenchmark/Foo/Basic.lean', limit: 20, nested: { a: 1 } });
    expect(summary).toEqual({ file_path: 'LeanEvalBenchmark/Foo/Basic.lean', limit: 20, nested: { a: 1 } });
  });

  it('truncates non-path strings head first at 200 chars', () => {
    expect(summarizeToolInput('Grep', { pattern: 'x'.repeat(250) }).pattern).toBe(`${'x'.repeat(200)}...`);
  });

  it('gives Bash commands the larger 2000-char budget', () => {
    const command = `grep -rn 'theorem' ${'sub/'.repeat(100)}Basic.lean`;
    expect(summarizeToolInput('Bash', { command }).command).toBe(command);
    expect(summarizeToolInput('Bash', { command: 'x'.repeat(2500) }).command).toBe(`${'x'.repeat(2000)}...`);
  });

  it('counts display lines like the frontend preview', () => {
    expect(countDisplayLines('')).toBe(0);
    expect(countDisplayLines('a\nb\n')).toBe(2);
    expect(countDisplayLines('a\nb')).toBe(2);
  });
});

describe('summarizeToolResult', () => {
  it('is JSON-safe and bounded at 500 chars', () => {
    expect(summarizeToolResult({ ok: true })).toBe('{"ok":true}');
    expect(summarizeToolResult('x'.repeat(600))).toBe(`${'x'.repeat(500)}...`);
    expect(summarizeToolResult(null)).toBeNull();
    expect(summarizeToolResult(undefined)).toBeNull();
  });
});
