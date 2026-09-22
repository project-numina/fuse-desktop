import { describe, expect, it } from 'vitest';
import { guideTopics } from '@/components/guide/topics';

describe('guideTopics', () => {
  it('defines the sidebar order with unique, route-safe slugs', () => {
    expect(guideTopics.map((topic) => topic.slug)).toEqual([
      'setup',
      'workspace',
      'blueprints',
      'agents',
      'pull-requests',
      'capabilities',
      'troubleshooting',
    ]);
    expect(new Set(guideTopics.map((topic) => topic.slug))).toHaveLength(guideTopics.length);

    for (const topic of guideTopics) {
      expect(topic.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(topic.label.trim()).not.toBe('');
      expect(topic.description).toMatch(/\.$/);
    }
  });

  it('keeps the legacy pull-request route while presenting it as Changes', () => {
    expect(guideTopics.find((topic) => topic.slug === 'pull-requests')).toMatchObject({
      label: 'Changes',
      description: expect.stringContaining('commit or push'),
    });
  });
});
