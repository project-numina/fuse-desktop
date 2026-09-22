import { describe, expect, it } from 'vitest';
import { mergePaths, parseShellPathOutput } from '@main/shell-path';

describe('parseShellPathOutput', () => {
  it('extracts the marked PATH even when the profile prints noise', () => {
    const output = 'Welcome!\n__FUSE_PATH__/opt/homebrew/bin:/usr/bin__FUSE_PATH__\n';
    expect(parseShellPathOutput(output)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('returns null without both markers', () => {
    expect(parseShellPathOutput('__FUSE_PATH__/usr/bin')).toBeNull();
    expect(parseShellPathOutput('nothing')).toBeNull();
  });
});

describe('mergePaths', () => {
  it('keeps order and removes duplicates and empty entries', () => {
    expect(mergePaths('/a:/b::/c', '/b:/d')).toBe('/a:/b:/c:/d');
  });
});
