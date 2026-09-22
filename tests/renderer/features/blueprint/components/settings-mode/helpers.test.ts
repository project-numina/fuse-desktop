import { describe, expect, it } from 'vitest';

import { ApiError, DEFAULT_BLUEPRINT_AGENT_CONFIG } from '@/lib/api';
import {
  agentConfigOf,
  removeErrorMessage,
  sameAgentConfig,
  saveErrorMessage,
  sourceUpdateErrorMessage,
} from '@/features/blueprint/components/settings-mode/helpers';

describe('settings mode helpers', () => {
  it('fills missing agent preferences with desktop defaults', () => {
    expect(agentConfigOf({ id: 'example' })).toEqual(DEFAULT_BLUEPRINT_AGENT_CONFIG);
    expect(agentConfigOf({
      agent: { ...DEFAULT_BLUEPRINT_AGENT_CONFIG, provider: 'codex' },
    }).provider).toBe('codex');
  });

  it('compares the normalized model saved by the API', () => {
    const saved = { ...DEFAULT_BLUEPRINT_AGENT_CONFIG, model: 'opus' };
    expect(sameAgentConfig({ ...saved, model: ' opus ' }, saved)).toBe(true);
    expect(sameAgentConfig({ ...saved, effort: 'high' }, saved)).toBe(false);
  });

  it('maps settings and source failures without exposing server details', () => {
    expect(saveErrorMessage(new ApiError('private', 403)))
      .toBe('You do not have permission to update this blueprint.');
    expect(sourceUpdateErrorMessage(new ApiError('private', 422)))
      .toBe('That file has no leanblueprint declarations Fuse can parse.');
    expect(saveErrorMessage(new Error('private'))).not.toContain('private');
  });

  it('only exposes the actionable conflict reason when removal is blocked', () => {
    expect(removeErrorMessage(new ApiError('An agent is still running.', 409)))
      .toBe('An agent is still running.');
    expect(removeErrorMessage(new ApiError('private', 500)))
      .toBe('Could not remove this workspace. Please try again.');
  });
});
