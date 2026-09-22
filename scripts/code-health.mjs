import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { exit, stdout } from 'node:process';
import ts from 'typescript';

const SOURCE_ROOT = 'src';
const FILE_SOFT_LIMIT = 500;
const FUNCTION_SOFT_LIMIT = 40;
const LARGE_FILE_ALLOWANCES = new Map([
  // Session lifecycle, streaming cursors, and rollback still share closure state.
  // Cap this existing exception until those ownership boundaries are separated.
  ['src/renderer/src/features/chat/state/store.tsx', 2200],
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function functionName(node, sourceFile) {
  if (node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) {
    return node.parent.name.getText(sourceFile);
  }
  return '<anonymous>';
}

function inspectFunctions(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const longFunctions = [];

  function visit(node) {
    if (isFunctionLike(node) && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.body.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.body.getEnd()).line + 1;
      const lines = end - start + 1;
      if (lines > FUNCTION_SOFT_LIMIT) {
        longFunctions.push({ file, line: start, lines, name: functionName(node, sourceFile) });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return longFunctions;
}

const sourceFiles = walk(SOURCE_ROOT)
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'));
const fileViolations = [];
const longFunctions = [];

for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8');
  const nonblankLines = source.split(/\r?\n/).filter((line) => line.trim()).length;
  const allowance = LARGE_FILE_ALLOWANCES.get(file.replaceAll('\\', '/')) ?? FILE_SOFT_LIMIT;
  if (nonblankLines > allowance) fileViolations.push({ file, nonblankLines, allowance });
  longFunctions.push(...inspectFunctions(file, source));
}

stdout.write(`Checked ${sourceFiles.length} source files.\n`);
stdout.write(`${longFunctions.length} function bodies exceed the ${FUNCTION_SOFT_LIMIT}-line soft limit.\n`);
for (const item of longFunctions.sort((left, right) => right.lines - left.lines).slice(0, 10)) {
  stdout.write(`  ${item.lines} lines  ${relative('.', item.file)}:${item.line}  ${item.name}\n`);
}

if (fileViolations.length) {
  stdout.write('\nUnapproved file-size regressions:\n');
  for (const item of fileViolations) {
    stdout.write(`  ${item.nonblankLines} lines  ${item.file} (allowance: ${item.allowance})\n`);
  }
  exit(1);
}

stdout.write('No unapproved files exceed the 500-line soft limit.\n');
