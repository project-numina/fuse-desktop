import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { branchState, sourceView } from '@main/services/blueprint-service/external-state';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { createProject } from './test-project';

let test: TestContext;

beforeEach(() => {
  test = createTestContext();
});

afterEach(() => test.cleanup());

describe('blueprint external state', () => {
  it('returns null branch metadata for a non-git folder', async () => {
    expect(await branchState(createProject(test))).toEqual({ status: null, freshness: null });
  });

  it('treats source-service failures as unavailable', async () => {
    const project = createProject(test);
    test.ctx.services.sources = { canonicalSourceView: vi.fn(async () => Promise.reject(new Error('offline'))) };
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await sourceView(test.ctx, project)).toBeNull();
    spy.mockRestore();
  });
});
