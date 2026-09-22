import { describe, expect, it } from 'vitest';

import { useStatus } from '@/hooks/use-status';

describe('useStatus', () => {
  const api = useStatus();

  it('resolves authoritative and fallback declaration states', () => {
    const entries = [
      { label: 'proved', status: 'proved' },
      { label: 'started', status: 'in_progress' },
      { label: 'explicit', status: 'not_started', lean_name: 'Still.Ignored' },
      { label: 'linked', lean_name: 'Mathlib.Result' },
    ];
    expect(api.statusOf('proved', entries)).toBe('proved');
    expect(api.statusOf('started', entries)).toBe('formalized');
    expect(api.statusOf('explicit', entries)).toBe('not_started');
    expect(api.statusOf('linked', entries)).toBe('formalized');
    expect(api.statusOf('missing', entries)).toBe('not_started');
  });

  it('returns display badges and pull-request labels', () => {
    expect(api.statusBadge('proved', '', [])).toEqual({ text: 'Formalized', class: 'status-proved' });
    expect(api.statusBadge('proved', 'def:done', [
      { kind: 'definition', label: 'def:done', status: 'proved' },
    ])).toEqual({ text: 'Formalized', class: 'status-proved' });
    expect(api.statusBadge('proved', 'thm:done', [
      { kind: 'theorem', label: 'thm:done', status: 'proved' },
    ])).toEqual({ text: 'Proved', class: 'status-proved' });
    expect(api.statusBadge('sorry', '', [])).toEqual({ text: 'Formalized', class: 'status-formalized' });
    expect(api.pullRequestStatusLabel('draft')).toBe('Draft');
    expect(api.pullRequestStatusLabel('custom')).toBe('custom');
  });
});
