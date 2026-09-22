import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new globalThis.URL('..', import.meta.url)).replace(/\/$/, '');

function writeLine(line = '') {
  stdout.write(`${line}\n`);
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function testPathFor(source) {
  const rendererRoot = join(appRoot, 'src', 'renderer', 'src');
  const sourceRoot = join(appRoot, 'src');
  const relativeSource = source.startsWith(rendererRoot + sep)
    ? join('renderer', relative(rendererRoot, source))
    : relative(sourceRoot, source);
  const extension = extname(relativeSource);
  const base = relativeSource.slice(0, -extension.length);
  return [
    join(appRoot, 'tests', `${base}.test.ts`),
    join(appRoot, 'tests', `${base}.test.tsx`),
  ];
}

const sourceFiles = walk(join(appRoot, 'src'))
  .filter((path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts'));
const paired = [];
const unpaired = [];
for (const source of sourceFiles) {
  const candidates = testPathFor(source);
  (candidates.some(existsSync) ? paired : unpaired).push(relative(appRoot, source));
}

const percent = sourceFiles.length === 0 ? 100 : (paired.length / sourceFiles.length) * 100;
writeLine(`${paired.length}/${sourceFiles.length} source files have a directly corresponding test (${percent.toFixed(1)}%).`);
if (unpaired.length) {
  writeLine();
  writeLine('Source files without a directly corresponding test:');
  for (const path of unpaired) writeLine(path);
}
