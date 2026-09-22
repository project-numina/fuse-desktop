import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireBuildSlot, DiagnosticAccumulator, errorsOf, newBuildOutput, resetBuildSlots, warningsOf, type BuildOutput, type Diagnostic } from '@main/services/lean/diagnostics';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

function accumulator(clonePath?: string): [BuildOutput, DiagnosticAccumulator] {
  const output = newBuildOutput();
  return [output, new DiagnosticAccumulator(output, { clonePath })];
}

describe('DiagnosticAccumulator', () => {
  it('progress line updates file counts', () => {
    const [output, acc] = accumulator();
    acc.feedLine('[12/345] Building Foo.Bar');
    acc.flush();
    expect(output.filesCompleted).toBe(12);
    expect(output.filesTotal).toBe(345);
    expect(output.message).toContain('Building Foo.Bar');
  });

  it('error header creates a diagnostic', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo/Bar.lean:10:5: error: type mismatch');
    acc.flush();
    const expected: Diagnostic = { file: 'Foo/Bar.lean', line: 10, column: 5, severity: 'error', message: 'type mismatch' };
    expect(errorsOf(output)).toEqual([expected]);
  });

  it('strips repeated ./ prefixes from the file path', () => {
    const [output, acc] = accumulator();
    acc.feedLine('././././Smoke/Basic.lean:1:19: error: type mismatch');
    acc.flush();
    expect(errorsOf(output)).toHaveLength(1);
    expect(errorsOf(output)[0].file).toBe('Smoke/Basic.lean');
  });

  it('makes absolute clone paths relative', () => {
    const clone = mkdtempSync(join(tmpdir(), 'fuse-lean-'));
    try {
      const [output, acc] = accumulator(clone);
      acc.feedLine(`${join(clone, 'Foo', 'Bar.lean')}:3:7: error: type mismatch`);
      acc.flush();
      expect(errorsOf(output)).toHaveLength(1);
      expect(errorsOf(output)[0].file).toBe('Foo/Bar.lean');
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it('attaches continuation lines to the pending diagnostic', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo/Bar.lean:10:5: error: type mismatch');
    acc.feedLine('  expected: Nat');
    acc.feedLine('  got: String');
    acc.flush();
    expect(errorsOf(output)).toHaveLength(1);
    const message = errorsOf(output)[0].message;
    expect(message).toContain('type mismatch');
    expect(message).toContain('expected: Nat');
    expect(message).toContain('got: String');
  });

  it('progress line flushes the pending diagnostic', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo/Bar.lean:10:5: error: first');
    acc.feedLine('[1/2] Building Other');
    acc.feedLine('Other.lean:1:1: error: second');
    acc.flush();
    expect(errorsOf(output).map((d) => d.message)).toEqual(['first', 'second']);
  });

  it('splits warnings and errors by severity', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo.lean:1:1: warning: unused variable');
    acc.feedLine('Foo.lean:2:1: error: undefined name');
    acc.flush();
    expect(warningsOf(output)).toHaveLength(1);
    expect(errorsOf(output)).toHaveLength(1);
    expect(warningsOf(output)[0].severity).toBe('warning');
    expect(errorsOf(output)[0].severity).toBe('error');
  });

  it('drops info diagnostics', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo.lean:1:1: info: hello');
    acc.flush();
    expect(output.diagnostics).toEqual([]);
  });

  it('parses the prefixed form', () => {
    const [output, acc] = accumulator();
    acc.feedLine('error: Foo.lean:5:3: missing semicolon');
    acc.flush();
    expect(errorsOf(output)).toHaveLength(1);
    expect(errorsOf(output)[0].file).toBe('Foo.lean');
    expect(errorsOf(output)[0].line).toBe(5);
  });

  it('preserves unscoped lake errors', () => {
    const [output, acc] = accumulator();
    acc.feedLine('error: no such file or directory');
    acc.feedLine("error: Kakeya.lean: bad import 'Kakeya.scratch_FM'");
    acc.feedLine('error: build failed');
    acc.flush();
    expect(output.unscopedErrors).toEqual(['no such file or directory', "Kakeya.lean: bad import 'Kakeya.scratch_FM'"]);
  });

  it('drops the build failed trailer', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo.lean:1:1: error: real failure');
    acc.feedLine('error: build failed');
    acc.flush();
    expect(errorsOf(output)).toHaveLength(1);
    expect(errorsOf(output)[0].message).not.toContain('build failed');
  });

  it('drops the lake failure summary trailers', () => {
    const [output, acc] = accumulator();
    acc.feedLine('././Foo.lean:1:1: error: type mismatch');
    acc.feedLine('  expected: Nat');
    acc.feedLine('  got: String');
    acc.feedLine('error: Lean exited with code 1');
    acc.feedLine('Some required builds logged failures:');
    acc.feedLine('- Foo');
    acc.flush();
    expect(errorsOf(output)).toHaveLength(1);
    expect(errorsOf(output)[0].file).toBe('Foo.lean');
    expect(errorsOf(output)[0].message).toBe('type mismatch\n  expected: Nat\n  got: String');
  });

  it('fires the progress callback on progress lines', () => {
    const output = newBuildOutput();
    const events: number[] = [];
    const acc = new DiagnosticAccumulator(output, { onProgress: (current) => events.push(current.filesCompleted) });
    acc.feedLine('[1/3] Building Foo');
    acc.feedLine('[2/3] Building Bar');
    acc.feedLine('Foo.lean:1:1: error: x');
    acc.feedLine('[3/3] Building Baz');
    acc.flush();
    expect(events).toEqual([1, 2, 3]);
  });

  it('records built modules from progress lines', () => {
    const [output, acc] = accumulator();
    acc.feedLine('[1/3] Building Foo.Bar');
    acc.feedLine('[2/3] Building Foo.Baz');
    acc.feedLine('[3/3] Compiling Foo.Bar:lib');
    acc.flush();
    expect(output.builtModules).toEqual(['Foo.Bar', 'Foo.Baz']);
  });

  it('skips non-module actions for built modules', () => {
    const [output, acc] = accumulator();
    acc.feedLine('[1/2] Compiling lean-foo:lib');
    acc.feedLine('[2/2] Linking lean-foo');
    acc.flush();
    expect(output.builtModules).toEqual([]);
  });

  it('parses the Lake >= 4.9 output format with status glyphs and durations', () => {
    // Captured from `lake build` on Lean v4.25.0.
    const lines = [
      '✖ [3/5] Building Sample.Squares (104ms)',
      'trace: .> LEAN_PATH=/x/.lake/build/lib/lean /x/lean /x/Sample/Squares.lean -o /x/Squares.olean --json',
      'error: Sample/Squares.lean:4:2: Tactic `rfl` failed: The left-hand side',
      '  twice 1',
      'is not definitionally equal to the right-hand side',
      '  3',
      '',
      '⊢ twice 1 = 3',
      'error: Lean exited with code 1',
      'Some required targets logged failures:',
      '- Sample.Squares',
      'error: build failed',
    ];
    const [output, acc] = accumulator();
    for (const line of lines) acc.feedLine(line);
    acc.flush();
    expect(output.filesCompleted).toBe(3);
    expect(output.filesTotal).toBe(5);
    expect(output.builtModules).toEqual(['Sample.Squares']);
    expect(output.unscopedErrors).toEqual([]);
    expect(errorsOf(output)).toEqual([
      {
        file: 'Sample/Squares.lean',
        line: 4,
        column: 2,
        severity: 'error',
        message: 'Tactic `rfl` failed: The left-hand side\n  twice 1\nis not definitionally equal to the right-hand side\n  3\n⊢ twice 1 = 3',
      },
    ]);
    const [ok, acc2] = accumulator();
    acc2.feedLine('✔ [3/5] Built Sample.Squares (12ms)');
    acc2.feedLine('⚠ [4/5] Replayed Sample.Extra');
    acc2.flush();
    expect(ok.builtModules).toEqual(['Sample.Squares']);
    expect(ok.message).toBe('[4/5] Replayed Sample.Extra');
  });

  it('caps runaway messages at 4000 characters', () => {
    const [output, acc] = accumulator();
    acc.feedLine('Foo.lean:1:1: error: start');
    for (let i = 0; i < 200; i += 1) acc.feedLine('x'.repeat(100));
    acc.flush();
    expect(errorsOf(output)[0].message).toHaveLength(4000);
  });
});

describe('build slots', () => {
  afterEach(() => resetBuildSlots());

  async function peakConcurrency(limit: number, workers: number): Promise<number> {
    resetBuildSlots();
    const settings = { ...DEFAULT_LEAN_SETTINGS, maxConcurrentLeanBuilds: limit };
    let active = 0;
    let peak = 0;
    const worker = async (): Promise<void> => {
      const release = await acquireBuildSlot(settings);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      release();
    };
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return peak;
  }

  it('is unbounded by default', async () => {
    expect(await peakConcurrency(0, 5)).toBe(5);
  });

  it('enforces the cap', async () => {
    expect(await peakConcurrency(2, 6)).toBe(2);
  });

  it('serializes with a cap of one', async () => {
    expect(await peakConcurrency(1, 4)).toBe(1);
  });

  it('treats negative caps as unbounded', async () => {
    expect(await peakConcurrency(-1, 3)).toBe(3);
  });
});
