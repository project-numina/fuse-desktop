import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BucketEntry } from '@/features/chat/hooks/chat-turns';
import ActivityBucket from '@/features/chat/components/ActivityBucket';

const tool = (key: string, count = 1, isError = false): BucketEntry => ({
  kind: 'activity', key, count, activity: { tool: 'Bash', summary: key, isError },
});
const renderEntry = (entry: BucketEntry, key: string) => <div key={key}>{entry.key}</div>;
const bucket = (entries: BucketEntry[]) => <ActivityBucket entries={entries} keyPrefix="turn-1" renderEntry={renderEntry} />;

describe('ActivityBucket', () => {
  it('keeps three calls visible', () => {
    render(bucket([tool('one'), tool('two'), tool('three')]));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('one')).toBeVisible();
    expect(screen.getByText('three')).toBeVisible();
  });

  it('collapses four calls and lets you expand and collapse them', () => {
    render(bucket([tool('one'), tool('two'), tool('three'), tool('four')]));
    const toggle = screen.getByRole('button', { name: '4 tool calls' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('one')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('one')).toBeVisible();
    expect(screen.getByText('four')).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText('four')).not.toBeVisible();
  });

  it('counts coalesced calls, reports failures, and preserves expansion as calls arrive', () => {
    const view = render(bucket([tool('repeated', 4, true)]));
    fireEvent.click(screen.getByRole('button', { name: '4 tool calls, 4 failed' }));
    view.rerender(bucket([tool('repeated', 4, true), tool('next')]));
    expect(screen.getByRole('button', { name: '5 tool calls, 4 failed' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('next')).toBeVisible();
  });

  it('does not fold subagent cards into tool groups', () => {
    render(bucket([tool('before', 4), { kind: 'subagents', key: 'subagent', subagents: [] }, tool('after', 5)]));
    expect(screen.getByText('subagent')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '4 tool calls' }));
    expect(screen.getByText('before')).toBeVisible();
    expect(screen.getByText('after')).not.toBeVisible();
  });
});
