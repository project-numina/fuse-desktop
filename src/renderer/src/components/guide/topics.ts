/**
 * Ordered list of guide topics used by the guide overview and the sidebar nav
 * in GuidePageLayout. Kept here so ordering is defined in exactly one place.
 */

export interface GuideTopic {
  /** URL slug under /guide. */
  slug: string;
  /** Short label shown in the sidebar and on the overview. */
  label: string;
  /** One-line plain-language description shown on the overview. */
  description: string;
}

export const guideTopics: GuideTopic[] = [
  {
    slug: 'setup',
    label: 'Setup',
    description:
      'Open a folder, set up the Lean project, and create your first blueprint.',
  },
  {
    slug: 'workspace',
    label: 'Workspace',
    description:
      'Find the workspace views, source documents, and running sessions.',
  },
  {
    slug: 'blueprints',
    label: 'Blueprints',
    description:
      'How a LaTeX argument connects to Lean, with a working example.',
  },
  {
    slug: 'agents',
    label: 'Agents',
    description:
      'Give an agent the right context and choose what it’s allowed to do.',
  },
  {
    // The slug is kept so existing links keep resolving; the page is about
    // local commits and branches now that there is no hosting service.
    slug: 'pull-requests',
    label: 'Changes',
    description:
      'Review changes and decide when to commit or push.',
  },
  {
    slug: 'capabilities',
    label: 'What to trust',
    description: 'What a checked proof tells you, and what you still need to check.',
  },
  {
    slug: 'troubleshooting',
    label: 'Troubleshooting',
    description: 'Fixes for the problems users hit most often.',
  },
];
