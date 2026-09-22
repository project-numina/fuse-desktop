import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectIncludedFiles,
  expandLatexIncludes,
  readUtf8,
  resolveInputFile,
  resolveProjectPath,
  resolvesUnder,
} from '@main/services/blueprint/latex/project';

let tmp: string;

function write(relative: string, content: string | Buffer): string {
  const target = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-latex-project-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('expandLatexIncludes / collectIncludedFiles', () => {
  it('expands transitive includes preserving CRLF', () => {
    const root = path.join(tmp, 'project');
    write('project/main.tex', Buffer.from('Start\r\n\\input{parts/a}\r\nEnd\r\n'));
    write('project/parts/a.tex', Buffer.from('A\r\n\\include{b}\r\n'));
    write('project/parts/b.tex', Buffer.from('B\r\n'));
    const expanded = expandLatexIncludes(path.join(root, 'main.tex'), root);
    expect(expanded).toBe('Start\r\nA\r\nB\r\n\r\nEnd\r\n');
    expect(expanded!.replace(/\r\n/g, '')).not.toContain('\n');
    expect(collectIncludedFiles(path.join(root, 'main.tex'), root)).toEqual(['main.tex', 'parts/a.tex', 'parts/b.tex']);
  });

  it('ignores comments, keeps missing includes and stops cycles', () => {
    const root = path.join(tmp, 'project');
    write('project/main.tex', '\\input{child} % \\input{commented}\n\\input{missing}\n');
    write('project/child.tex', 'child \\input{main}\n');
    expect(expandLatexIncludes(path.join(root, 'main.tex'), root)).toBe('child \n % \\input{commented}\n\\input{missing}\n');
    expect(collectIncludedFiles(path.join(root, 'main.tex'), root)).toEqual(['main.tex', 'child.tex']);
  });

  it('enforces containment after normalization', () => {
    const root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    const current = path.join(root, 'dir', 'current.tex');
    expect(resolveProjectPath(root, '../outside.tex')).toBeNull();
    expect(resolveInputFile(current, '../../outside', root)).toBeNull();
    expect(resolveInputFile(current, '/absolute', root)).toBeNull();
    const contained = resolveProjectPath(root, 'dir/../main.tex');
    expect(contained).not.toBeNull();
    expect(path.normalize(contained!)).toBe(path.join(root, 'main.tex'));
  });

  it.skipIf(process.platform === 'win32')('does not follow a symlink escape and honours the depth bound', () => {
    const root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    const outside = write('outside.tex', 'outside');
    fs.symlinkSync(outside, path.join(root, 'link.tex'));
    write('project/main.tex', '\\input{link}\n\\input{one}\n');
    write('project/one.tex', '\\input{two}\n');
    write('project/two.tex', 'two\n');
    expect(expandLatexIncludes(path.join(root, 'main.tex'), root, { maxDepth: 0 })).toBe('\\input{link}\n\n');
    expect(collectIncludedFiles(path.join(root, 'main.tex'), root)).toEqual(['main.tex', 'one.tex', 'two.tex']);
  });

  it('covers escapes, unreadable files and an explicit reader', () => {
    const root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    expect(resolveInputFile(path.join(root, 'a.tex'), '', root)).toBeNull();
    expect(resolveProjectPath(root, path.resolve('/tmp/absolute'))).toBeNull();
    expect(resolvesUnder(path.join(root, 'missing.tex'), root)).toBe(true);
    expect(readUtf8(path.join(root, 'missing.tex'))).toBeNull();

    const brokenReader = (): string | null => {
      throw new Error('no read');
    };
    expect(expandLatexIncludes(path.join(root, 'missing.tex'), root, { reader: brokenReader })).toBeNull();
    expect(collectIncludedFiles(path.join(root, 'missing.tex'), root, { reader: brokenReader })).toEqual([]);

    write('project/plain.tex', '\\input{missing.tex}');
    expect(resolveInputFile(path.join(root, 'plain.tex'), 'missing.tex', root)).toBe(path.join(root, 'missing.tex'));
    expect(expandLatexIncludes(path.join(root, 'plain.tex'), root)).toBe('\\input{missing.tex}');

    const outside = write('outside.tex', 'outside');
    expect(expandLatexIncludes(outside, root)).toBeNull();
    expect(collectIncludedFiles(outside, root)).toEqual([]);
  });

  it.each(['bad\x00path', 'x'.repeat(10_000)])('fails closed on a malformed include target', (target) => {
    const root = path.join(tmp, 'project');
    const main = write('project/main.tex', `before\\input{${target}}after\n`);
    expect(resolveInputFile(main, target, root)).toBeNull();
    expect(collectIncludedFiles(main, root)).toEqual(['main.tex']);
    expect(expandLatexIncludes(main, root)).toBe(`before\\input{${target}}after\n`);
  });

  it('searches the TeX working directory before the including file', () => {
    const root = path.join(tmp, 'project');
    const source = path.join(root, 'blueprint', 'src');
    write('project/blueprint/src/content.tex', '\\input{chapters/one}\n');
    write('project/blueprint/src/chapters/one.tex', '\\input{chapters/two}\n');
    write('project/blueprint/src/chapters/two.tex', 'two\n');
    expect(collectIncludedFiles(path.join(source, 'content.tex'), root, { inputSearchRoots: [source] })).toEqual([
      'blueprint/src/content.tex',
      'blueprint/src/chapters/one.tex',
      'blueprint/src/chapters/two.tex',
    ]);
  });

  it('ignores opaque environments and inline verbatim examples', () => {
    const root = path.join(tmp, 'project');
    write(
      'project/main.tex',
      '\\begin{verbatim}\n\\input{missing-one}\n\\end{verbatim}\n\\verb|\\input{missing-two}|\n\\input{real}\n',
    );
    write('project/real.tex', 'real\n');
    expect(collectIncludedFiles(path.join(root, 'main.tex'), root)).toEqual(['main.tex', 'real.tex']);
  });

  it.each(['\x0b', '\x85', '\u2028'])('does not treat separator %j as a line feed', (separator) => {
    write('main.tex', `% hidden${separator}\\input{missing}\n\\input{real}\n`);
    write('real.tex', 'real\n');
    expect(collectIncludedFiles(path.join(tmp, 'main.tex'), tmp)).toEqual(['main.tex', 'real.tex']);
  });

  it('does not let an escaped url brace hide a later comment', () => {
    write('main.tex', '\\url{https://example.test/\\{} % \\input{missing}\n\\input{real}\n');
    write('real.tex', 'real\n');
    expect(collectIncludedFiles(path.join(tmp, 'main.tex'), tmp)).toEqual(['main.tex', 'real.tex']);
  });

  it('reports every include directive through the observer', () => {
    write('main.tex', '\\input{one}\n\\input{missing}\n');
    write('one.tex', 'one\n');
    const seen: Array<[string, number, string, boolean]> = [];
    collectIncludedFiles(path.join(tmp, 'main.tex'), tmp, {
      onInput: (current, line, raw, child) => seen.push([path.basename(current), line, raw, child !== null]),
    });
    expect(seen).toEqual([
      ['main.tex', 1, 'one', true],
      ['main.tex', 2, 'missing', true],
    ]);
  });
});

describe('readUtf8', () => {
  it('reads CRLF untouched and rejects invalid UTF-8', () => {
    const crlf = write('crlf.tex', Buffer.from('a\r\nb\r\n'));
    expect(readUtf8(crlf)).toBe('a\r\nb\r\n');
    const binary = write('bad.tex', Buffer.from([0xff, 0xfe, 0x41]));
    expect(readUtf8(binary)).toBeNull();
  });
});

describe('fixture project', () => {
  const fixture = path.resolve(__dirname, '../../../../../fixtures/sample-blueprint');
  const entry = path.join(fixture, 'blueprint', 'src', 'content.tex');

  it('walks the sample blueprint chapters in order', () => {
    expect(collectIncludedFiles(entry, fixture, { inputSearchRoots: [path.dirname(entry)] })).toEqual([
      'blueprint/src/content.tex',
      'blueprint/src/chapters/doubling.tex',
      'blueprint/src/chapters/squares.tex',
    ]);
    const expanded = expandLatexIncludes(entry, fixture, { inputSearchRoots: [path.dirname(entry)] });
    expect(expanded).toContain('\\chapter{Doubling}');
    expect(expanded).toContain('\\chapter{Squares}');
    expect(expanded).not.toContain('\\input{');
  });
});
