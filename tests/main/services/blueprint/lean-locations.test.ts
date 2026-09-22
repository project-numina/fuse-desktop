import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cachedLeanLocation, readCachedLeanLocations, resolverImports, splitDeclarationNames } from '@main/services/blueprint/lean-locations';

let tmp: string;

function write(relative: string, content = ''): void {
  const target = join(tmp, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** Create the build artifact required for a safe resolver import. */
function builtModule(moduleName: string): void {
  write(`.lake/build/lib/lean/${moduleName.replace(/\./g, '/')}.olean`);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuse-locations-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('splitDeclarationNames', () => {
  it('splits, trims and de-duplicates', () => {
    expect(splitDeclarationNames(' A.b, C , A.b,,')).toEqual(['A.b', 'C']);
    expect(splitDeclarationNames('')).toEqual([]);
  });
});

describe('resolverImports', () => {
  it('uses the configured module and lake umbrella modules, only when built', () => {
    write('lakefile.toml', 'name = "demo"\n[[lean_lib]]\nname = "Demo"\n');
    write('Demo/Target.lean');
    write('Demo.lean');
    write('Extra.lean');
    builtModule('Demo.Target');
    builtModule('Demo');
    expect(resolverImports(tmp, 'Demo.Target.lean')).toEqual(['Demo.Target', 'Demo']);
  });

  it('reads lakefile.lean libraries and falls back to root modules', () => {
    write('lakefile.lean', 'import Lake\nopen Lake DSL\n\nlean_lib «Froda» where\n  roots := #[`Froda]\nlean_lib Other\n');
    builtModule('Froda');
    expect(resolverImports(tmp, null)).toEqual(['Froda']);
    rmSync(join(tmp, 'lakefile.lean'));
    write('Root.lean');
    builtModule('Root');
    expect(resolverImports(tmp, null)).toEqual(['Root']);
    expect(resolverImports(join(tmp, 'missing'), null)).toEqual([]);
  });
});

describe('cached locations', () => {
  it('reads a valid cache and ignores invalid ones', () => {
    write(
      '.lake/fuse-declaration-locations.json',
      JSON.stringify({
        version: 1,
        fingerprint: 'abc',
        locations: {
          'Demo.main': { declaration: 'Demo.main', file: 'Demo/Source.lean', start_line: 17, start_column: 1, end_line: 17, end_column: 10 },
          'Demo.other': { file: 'Demo/Other.lean', start_line: 3 },
          broken: 'not an object',
        },
        unresolved: [],
      }),
    );
    const locations = readCachedLeanLocations(tmp);
    expect(Object.keys(locations).sort()).toEqual(['Demo.main', 'Demo.other']);
    expect(cachedLeanLocation(locations, 'Demo.main')).toEqual(['Demo/Source.lean', 17]);
    expect(cachedLeanLocation({ 'Demo.main': { file: 'Demo/Source.lean', start_line: 17 } }, 'Demo.main')).toEqual(['Demo/Source.lean', 17]);
    expect(cachedLeanLocation(locations, 'Demo.missing')).toEqual(['', 0]);
    expect(cachedLeanLocation(locations, 'Demo.main, Demo.other')).toEqual(['', 0]);
    expect(cachedLeanLocation(locations, '')).toEqual(['', 0]);
    expect(cachedLeanLocation({ x: { file: '' } }, 'x')).toEqual(['', 0]);

    write('.lake/fuse-declaration-locations.json', JSON.stringify({ version: 2, locations: { a: { file: 'A.lean' } } }));
    expect(readCachedLeanLocations(tmp)).toEqual({});
    write('.lake/fuse-declaration-locations.json', '{oops');
    expect(readCachedLeanLocations(tmp)).toEqual({});
    write('.lake/fuse-declaration-locations.json', JSON.stringify({ version: 1, locations: [] }));
    expect(readCachedLeanLocations(tmp)).toEqual({});
    expect(readCachedLeanLocations(join(tmp, 'nowhere'))).toEqual({});
  });
});
