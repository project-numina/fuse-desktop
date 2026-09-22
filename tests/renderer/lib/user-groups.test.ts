import { describe, expect, it } from 'vitest';

import { USER_GROUP_OPTIONS } from '@/lib/user-groups';

describe('user groups', () => {
  it('exposes the supported values and human-readable labels in display order', () => {
    expect(USER_GROUP_OPTIONS).toEqual([
      { value: 'numina', label: 'Numina' },
      {
        value: 'internal_tester',
        label: 'Internal testers and mathematicians',
      },
      { value: 'public_tester', label: 'Public testers' },
    ]);
  });

  it('uses unique, non-empty values and labels', () => {
    const values = USER_GROUP_OPTIONS.map(({ value }) => value);
    const labels = USER_GROUP_OPTIONS.map(({ label }) => label);

    expect(new Set(values).size).toBe(values.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect([...values, ...labels].every((item) => item.length > 0)).toBe(true);
  });

  it('does not accept an unknown administrative group', () => {
    const values = USER_GROUP_OPTIONS.map(({ value }): string => value);
    expect(values).not.toContain('administrator');
  });
});
