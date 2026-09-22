/** Administrative groups available for Fuse users. */
export const USER_GROUP_OPTIONS = [
  { value: 'numina', label: 'Numina' },
  {
    value: 'internal_tester',
    label: 'Internal testers and mathematicians',
  },
  { value: 'public_tester', label: 'Public testers' },
] as const;

export type UserGroup = (typeof USER_GROUP_OPTIONS)[number]['value'];
