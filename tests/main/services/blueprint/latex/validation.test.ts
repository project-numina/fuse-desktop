import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  boundValidationIssues,
  loadBlueprintSourceClosure,
  renderValidationIssue,
  validateBlueprintGraph,
  validationErrors,
  validationOk,
  validationSummary,
  validationWarnings,
} from '@main/services/blueprint/latex/validation';

const ENTRYPOINT = 'blueprint/src/content.tex';

let tmp: string;

function write(relative: string, content: string): void {
  const target = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-latex-validation-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('validateBlueprintGraph', () => {
  it('reports coverage for a clean multi-file graph', () => {
    write(ENTRYPOINT, '\\input{chapters/one}\n\\input{chapters/two}\n');
    write('blueprint/src/chapters/one.tex', '\\begin{definition}\\label{def:a}A\\end{definition}\n');
    write('blueprint/src/chapters/two.tex', '\\begin{lemma}\\label{lem:b}\\uses{def:a}B\\end{lemma}\n');
    const result = validateBlueprintGraph(tmp, ENTRYPOINT);
    expect(validationOk(result)).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.declarationCount).toBe(2);
    expect(result.filesChecked).toEqual([ENTRYPOINT, 'blueprint/src/chapters/one.tex', 'blueprint/src/chapters/two.tex']);
    expect(validationSummary(result)).toBe('Checked 2 declarations across 3 TeX files; found 0 errors and 0 warnings.');
  });

  it('anchors duplicate and unknown dependency issues at their source lines', () => {
    write(
      ENTRYPOINT,
      '\\begin{lemma}\\label{lem:a}A\\end{lemma}\n\n\\begin{lemma}\\label{lem:a}B\\end{lemma}\n\\begin{theorem}\\label{thm:c}\\uses{lem:missing}C\\end{theorem}\n',
    );
    const result = validateBlueprintGraph(tmp, ENTRYPOINT);
    expect(validationOk(result)).toBe(false);
    const duplicate = result.issues.find((issue) => issue.code === 'duplicate_label')!;
    const unknown = result.issues.find((issue) => issue.code === 'unknown_dependency')!;
    expect(duplicate.file).toBe(ENTRYPOINT);
    expect(duplicate.line).toBe(3);
    expect(duplicate.message).toContain(`${ENTRYPOINT}:1`);
    expect(unknown.line).toBe(4);
    expect(unknown.message).toContain('\\uses{lem:missing}');
  });

  it('reports one deterministic cycle component', () => {
    write(ENTRYPOINT, '\\begin{lemma}\\label{lem:b}\\uses{lem:a}B\\end{lemma}\n\\begin{lemma}\\label{lem:a}\\uses{lem:b}A\\end{lemma}\n');
    const cycles = validateBlueprintGraph(tmp, ENTRYPOINT).issues.filter((issue) => issue.code === 'dependency_cycle');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].line).toBe(2);
    expect(cycles[0].message).toBe('dependency cycle between: lem:a, lem:b.');
  });

  it('treats a self dependency as a cycle', () => {
    write(ENTRYPOINT, '\\begin{lemma}\\label{lem:a}\\uses{lem:a}A\\end{lemma}\n');
    expect(validationErrors(validateBlueprintGraph(tmp, ENTRYPOINT)).map((issue) => issue.code)).toEqual(['dependency_cycle']);
  });

  it('ignores comments', () => {
    write(ENTRYPOINT, '% \\begin{lemma}\\label{lem:fake}\\uses{missing}X\\end{lemma}\n\\begin{lemma}\\label{lem:real}X\\end{lemma}\n');
    const result = validateBlueprintGraph(tmp, ENTRYPOINT);
    expect(validationOk(result)).toBe(true);
    expect(result.declarationCount).toBe(1);
  });

  it('resolves includes from the TeX working directory', () => {
    write(ENTRYPOINT, '\\input{chapters/one}\n');
    write('blueprint/src/chapters/one.tex', '\\input{chapters/two}\n');
    write('blueprint/src/chapters/two.tex', '\\begin{lemma}\\label{lem:a}A\\end{lemma}\n');
    const result = validateBlueprintGraph(tmp, ENTRYPOINT);
    expect(validationOk(result)).toBe(true);
    expect(result.declarationCount).toBe(1);
  });

  it('fails closed on an escaping or missing entrypoint', () => {
    expect(validationErrors(validateBlueprintGraph(tmp, '../outside.tex')).map((issue) => issue.code)).toEqual(['unsafe_entrypoint']);
    expect(validationErrors(validateBlueprintGraph(tmp, ENTRYPOINT)).map((issue) => issue.code)).toEqual(['source_not_found']);
  });

  it('reports a missing included source', () => {
    write(ENTRYPOINT, '\\input{chapters/missing}\n');
    const errors = validationErrors(validateBlueprintGraph(tmp, ENTRYPOINT));
    expect(errors.map((issue) => issue.code)).toEqual(['source_unreadable']);
    expect(errors[0].file).toBe('blueprint/src/chapters/missing.tex');
  });

  it('rejects an oversized source with a rendered diagnostic', () => {
    write(ENTRYPOINT, '123456789');
    const result = validateBlueprintGraph(tmp, ENTRYPOINT, undefined, { maxSourceFileBytes: 8 });
    expect(result.declarationCount).toBe(0);
    const errors = validationErrors(result);
    expect(errors.map((issue) => issue.code)).toEqual(['source_file_too_large']);
    expect(renderValidationIssue(errors[0])).toBe(`${ENTRYPOINT}:1: error: TeX source exceeds the 4 MiB per-file validation limit.`);
  });

  it('bounds the issue report', () => {
    write(ENTRYPOINT, '\\begin{lemma}\\label{lem:a}\\uses{missing:a, missing:b, missing:c, missing:d}A\\end{lemma}\n');
    const result = validateBlueprintGraph(tmp, ENTRYPOINT, undefined, { maxValidationIssues: 3 });
    expect(validationErrors(result).map((issue) => issue.code)).toEqual(['unknown_dependency', 'unknown_dependency']);
    expect(validationWarnings(result).map((issue) => issue.code)).toEqual(['issues_truncated']);
    expect(validationWarnings(result)[0].message).toBe('2 additional findings were omitted.');
  });

  it('reports the source file limit once', () => {
    write(ENTRYPOINT, '\\input{one}\n\\input{two}\n');
    write('blueprint/src/one.tex', 'one\n');
    write('blueprint/src/two.tex', 'two\n');
    const result = validateBlueprintGraph(tmp, ENTRYPOINT, undefined, { maxSourceFiles: 1 });
    expect(validationErrors(result).map((issue) => issue.code)).toEqual(['source_file_limit']);
  });

  it('bounds input reference collection', () => {
    write(ENTRYPOINT, '\\input{missing-one}\n\\input{missing-two}\n\\input{missing-three}\n\\input{missing-four}\n');
    const closure = loadBlueprintSourceClosure(tmp, ENTRYPOINT, { maxInputReferences: 2 });
    expect(closure.inputs).toHaveLength(2);
    expect(closure.inputs[0]).toEqual({
      file: ENTRYPOINT,
      line: 1,
      rawTarget: 'missing-one',
      targetFile: 'blueprint/src/missing-one.tex',
      targetExists: false,
    });
    expect(closure.issues.filter((issue) => issue.code === 'source_input_limit')).toHaveLength(1);
    const result = validateBlueprintGraph(tmp, ENTRYPOINT, closure);
    expect(validationErrors(result).map((issue) => issue.code)).toContain('source_input_limit');
  });

  it('rejects a closure for a different blueprint', () => {
    write(ENTRYPOINT, 'x');
    const closure = loadBlueprintSourceClosure(tmp, ENTRYPOINT);
    expect(() => validateBlueprintGraph(tmp, 'other.tex', closure)).toThrow('source closure does not match');
  });

  it('bounds combined issues through boundValidationIssues', () => {
    const issues = Array.from({ length: 4 }, (_, index) => ({
      code: 'x',
      file: 'f',
      line: index + 1,
      severity: 'error' as const,
      message: String(index),
    }));
    const bounded = boundValidationIssues(issues, ENTRYPOINT, 3);
    expect(bounded.map((issue) => issue.code)).toEqual(['x', 'x', 'issues_truncated']);
  });

  it('validates the fixture project', () => {
    const fixture = path.resolve(__dirname, '../../../../../fixtures/sample-blueprint');
    const result = validateBlueprintGraph(fixture, ENTRYPOINT);
    expect(validationOk(result)).toBe(true);
    expect(result.declarationCount).toBe(6);
    expect(result.filesChecked).toEqual([ENTRYPOINT, 'blueprint/src/chapters/doubling.tex', 'blueprint/src/chapters/squares.tex']);
  });
});
