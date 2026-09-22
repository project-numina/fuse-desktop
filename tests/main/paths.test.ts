import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appPaths, assertSafeSegment } from '@main/paths';
import { HttpError } from '@main/store/registry';

describe('appPaths', () => {
  const paths = appPaths('/tmp/fuse-user-data');

  it('places conversation files and blueprint directories under the data dir', () => {
    expect(paths.conversationFile('0f5a2c1e-1234-4abc-9def-0123456789ab')).toBe(
      join('/tmp/fuse-user-data', 'data', 'conversations', '0f5a2c1e-1234-4abc-9def-0123456789ab.json'),
    );
    expect(paths.blueprintDir(3, 'my-blueprint.v2')).toBe(join('/tmp/fuse-user-data', 'data', 'repositories', '3', 'blueprints', 'my-blueprint.v2'));
  });

  it('rejects ids that would escape the intended directory with a 404', () => {
    const backslash = String.fromCharCode(92);
    for (const bad of ['../repositories', '..', '.', '', 'a/b', `a${backslash}b`, '.hidden', 'x%2F..', 'a b', ' ']) {
      expect(() => paths.conversationFile(bad), bad).toThrow(HttpError);
      expect(() => paths.blueprintDir(1, bad), bad).toThrow(HttpError);
    }
    let caught: unknown;
    try {
      paths.conversationFile('../repositories');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
    expect((caught as HttpError).code).toBe('http_404');
  });

  it('assertSafeSegment returns the value it accepted', () => {
    expect(assertSafeSegment('abc-1_2.3', 'x')).toBe('abc-1_2.3');
  });
});
