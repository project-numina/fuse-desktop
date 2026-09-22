import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deferred, sleep } from '@main/services/lean/async';
import { FAILED_DEPENDENCIES_PREFIX, readMatchingFileDiagnostics, readSnapshot, replaceSingleFile, sourceContentHash } from '@main/services/lean/build/snapshot';
import type { LeanLSPClient } from '@main/services/lean/lsp/client';
import { LeanProcessExited } from '@main/services/lean/lsp/errors';
import { DiagnosticSeverity, type DiagnosticReport, type LspDiagnostic, type Position, type Range } from '@main/services/lean/lsp/models';
import {
  BUILD_IN_PROGRESS_MESSAGE,
  extractFailedDependencyPaths,
  isBuildStderr,
  LeanLSPService,
  LeanToolError,
  processDiagnostics,
  searchSymbols,
  splitLines,
  type LeanLSPServiceOptions,
} from '@main/services/lean/lsp/service';
import { DEFAULT_LEAN_SETTINGS } from '@main/services/lean/settings';

function raw(message: string, start: Position, end: Position = start, severity: DiagnosticSeverity | null = DiagnosticSeverity.Error, fullRange: Range | null = null): LspDiagnostic {
  return { range: { start, end }, message, severity, fullRange, source: null };
}

describe('build stderr detection', () => {
  it('recognizes lake stderr relayed as a diagnostic', () => {
    expect(isBuildStderr('lake setup-file failed: foo')).toBe(true);
    expect(isBuildStderr('error: A.lean:1:1: bad')).toBe(true);
    expect(isBuildStderr('type mismatch')).toBe(false);
    expect(isBuildStderr('type mismatch')).toBe(false);
  });

  it('collects distinct sorted dependency paths', () => {
    expect(extractFailedDependencyPaths('error: B.lean:3:1: boom\nwarning: A.lean:1:1: meh\nerror: B.lean:9:2: boom again\n')).toEqual(['A.lean', 'B.lean']);
    expect(extractFailedDependencyPaths('nothing here')).toEqual([]);
  });
});

describe('processDiagnostics', () => {
  it('splits build stderr into failed_dependencies and 1-indexes the rest', () => {
    const result = processDiagnostics(
      [raw('error: Dep.lean:2:1: boom', { line: 0, character: 0 }), raw('real error', { line: 7, character: 3 }, { line: 7, character: 9 })],
      false,
    );
    expect(result.failed_dependencies).toEqual(['Dep.lean']);
    expect(result.items).toHaveLength(1);
    const [item] = result.items;
    expect([item.line, item.column, item.end_line, item.end_column]).toEqual([8, 4, 8, 10]);
    expect(item.severity).toBe('error');
    expect(result.success).toBe(false);
    expect(result.complete).toBe(true);
  });

  it('prefers fullRange and labels unknown severities', () => {
    const result = processDiagnostics([raw('x', { line: 0, character: 0 }, { line: 0, character: 0 }, 2, { start: { line: 10, character: 0 }, end: { line: 12, character: 5 } })], true, false);
    expect(result.items[0]).toMatchObject({ line: 11, column: 1, end_line: 13, end_column: 6, severity: 'warning' });
    expect(result.complete).toBe(false);
    const unknown = processDiagnostics([raw('x', { line: 0, character: 1 }, { line: 0, character: 1 }, 99 as DiagnosticSeverity)], true);
    expect(unknown.items[0].severity).toBe('unknown(99)');
    const missing = processDiagnostics([raw('x', { line: 2, character: 0 }, { line: 2, character: 0 }, null)], true);
    expect(missing.items[0].severity).toBe('error');
  });
});

describe('searchSymbols', () => {
  it('matches leaf and qualified names', () => {
    const symbols = [{ name: 'foo' }];
    expect(searchSymbols(symbols, 'foo')).toBe(symbols[0]);
    const child = { name: 'child' };
    expect(searchSymbols([{ name: 'Ns', children: [child] }], 'Ns.child')).toBe(child);
    expect(searchSymbols([{ name: 'foo' }], 'bar')).toBeNull();
  });

  it('matches flat fully-qualified names by segment suffix only', () => {
    const symbol = { name: 'LeanEval.GameTheory.tendsto_coord_of_dist_le' };
    expect(searchSymbols([symbol], 'tendsto_coord_of_dist_le')).toBe(symbol);
    const partial = { name: 'LeanEval.GameTheory.foo' };
    expect(searchSymbols([partial], 'GameTheory.foo')).toBe(partial);
    expect(searchSymbols([{ name: 'Ns.foobar' }], 'bar')).toBeNull();
  });

  it('prefers exact matches and refuses ambiguity', () => {
    const suffixCandidate = { name: 'Ns.foo' };
    const exact = { name: 'foo' };
    expect(searchSymbols([suffixCandidate, exact], 'foo')).toBe(exact);
    expect(searchSymbols([{ name: 'A.foo' }, { name: 'B.foo' }], 'foo')).toBeNull();
    const nested = [{ name: 'A', children: [{ name: 'foo' }] }, { name: 'B', children: [{ name: 'foo' }] }];
    expect(searchSymbols(nested, 'foo')).toBeNull();
    expect(searchSymbols(nested, 'A.foo')).toEqual({ name: 'foo' });
  });
});

describe('splitLines', () => {
  it('matches Python splitlines on newline-normalized text', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a')).toEqual(['a']);
    expect(splitLines('a\n')).toEqual(['a']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });
});

/** A scripted stand-in for `LeanLSPClient`: records requests, returns canned results. */
class FakeClient {
  returncode: number | null = null;
  readonly calls: Array<[string, unknown]> = [];
  goalResult: { rendered: string; goals: string[] } | null = null;
  termGoalResult: { goal: string; range: Range } | null = null;
  hoverResult: { contents: string; range: Range | null } | null = null;
  report: DiagnosticReport = { documentVersion: 0, diagnostics: [], complete: true, timedOut: false, processingRanges: [], hasErrors: false };
  failNext: Error | null = null;
  closed = false;

  constructor(private readonly root: string) {}

  private content(path: string): string {
    return readFileSync(join(this.root, path), 'utf8').replace(/\r\n/g, '\n');
  }

  async openDocument(path: string, options?: unknown) {
    this.calls.push(['openDocument', { path, options }]);
    return { path, uri: `file://${path}`, content: this.content(path), version: 0 };
  }

  async documentContent(path: string): Promise<string> {
    return this.content(path);
  }

  async reloadDocument(path: string, mode?: string): Promise<void> {
    this.calls.push(['reloadDocument', { path, mode }]);
  }

  private maybeFail(): void {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  async goal(path: string, position: Position) {
    this.calls.push(['goal', { path, position }]);
    this.maybeFail();
    return this.goalResult;
  }

  async termGoal(path: string, position: Position) {
    this.calls.push(['termGoal', { path, position }]);
    return this.termGoalResult;
  }

  async hover(path: string, position: Position) {
    this.calls.push(['hover', { path, position }]);
    return this.hoverResult;
  }

  async diagnostics(path: string, options: unknown) {
    this.calls.push(['diagnostics', { path, options }]);
    return this.report;
  }

  async documentSymbols() {
    return [];
  }

  async closeIdleDocuments(): Promise<string[]> {
    return [];
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('LeanLSPService', () => {
  let root: string;
  let client: FakeClient;
  let created = 0;

  function service(overrides: Partial<Pick<LeanLSPServiceOptions, 'buildBlocking' | 'requireReady' | 'createClient'>> = {}): LeanLSPService {
    return new LeanLSPService({
      projectRoot: root,
      repositoryRoot: root,
      settings: { ...DEFAULT_LEAN_SETTINGS, lspFileIdleTtlMs: 0 },
      createClient: async () => {
        created += 1;
        client = new FakeClient(root);
        return client as unknown as LeanLSPClient;
      },
      ...overrides,
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fuse-lsp-service-'));
    mkdirSync(join(root, 'Sub'));
    writeFileSync(join(root, 'Sub', 'Main.lean'), 'theorem foo : True := by\n  trivial\n  -- λ ok\n');
    created = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves absolute, alias and relative paths', () => {
    const svc = service();
    expect(svc.resolveRelativePath('Sub/Main.lean')).toBe('Sub/Main.lean');
    expect(svc.resolveRelativePath(join(root, 'Sub', 'Main.lean'))).toBe('Sub/Main.lean');
    expect(svc.resolveRelativePath('/workspace/Sub/Main.lean')).toBe('Sub/Main.lean');
    expect(() => svc.resolveRelativePath(join(tmpdir(), 'elsewhere.lean'))).toThrow(/outside the assigned Lean project/);
  });

  it('queries goals at the cursor with UTF-16 columns and clamps past the end', async () => {
    const svc = service();
    client = undefined as unknown as FakeClient;
    const first = await svc.goal('Sub/Main.lean', 2, 3);
    expect(created).toBe(1);
    client.goalResult = { rendered: '', goals: ['⊢ True'] };
    const result = await svc.goal('Sub/Main.lean', 2, 3);
    expect(result).toEqual({ lineContext: '  trivial', goals: ['⊢ True'] });
    expect(client.calls.filter(([name]) => name === 'goal').pop()?.[1]).toEqual({ path: 'Sub/Main.lean', position: { line: 1, character: 2 } });
    expect(first.goals).toEqual([]);
    await svc.goal('Sub/Main.lean', 3, 999);
    expect(client.calls.pop()?.[1]).toEqual({ path: 'Sub/Main.lean', position: { line: 2, character: '  -- λ ok'.length } });
  });

  it('returns before/after goals when the column is omitted', async () => {
    const svc = service();
    await svc.goal('Sub/Main.lean', 1);
    client.goalResult = { rendered: '', goals: ['g'] };
    const result = await svc.goal('Sub/Main.lean', 2);
    expect(result).toEqual({ lineContext: '  trivial', goalsBefore: ['g'], goalsAfter: ['g'] });
    const positions = client.calls.filter(([name]) => name === 'goal').slice(-2).map(([, args]) => (args as { position: Position }).position);
    expect(positions).toEqual([{ line: 1, character: 2 }, { line: 1, character: 9 }]);
  });

  it('rejects lines outside the file with the cursor error text', async () => {
    const svc = service();
    await expect(svc.goal('Sub/Main.lean', 4, 1)).rejects.toThrow('Line 4 out of range (file has 3 lines)');
    await expect(svc.hover('Sub/Main.lean', 0, 1)).rejects.toThrow(LeanToolError);
  });

  it('strips the lean fence from term goals and defaults to the line end', async () => {
    const svc = service();
    await svc.goal('Sub/Main.lean', 1, 1);
    client.termGoalResult = { goal: '```lean\nNat\n```', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
    expect(await svc.termGoal('Sub/Main.lean', 1)).toEqual({ lineContext: 'theorem foo : True := by', expectedType: 'Nat' });
    expect(client.calls.pop()?.[1]).toEqual({ path: 'Sub/Main.lean', position: { line: 0, character: 'theorem foo : True := by'.length } });
    client.termGoalResult = null;
    expect((await svc.termGoal('Sub/Main.lean', 1, 2)).expectedType).toBeNull();
  });

  it('passes hover ranges through untouched', async () => {
    const svc = service();
    await svc.goal('Sub/Main.lean', 1, 1);
    const range = { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } };
    client.hoverResult = { contents: 'doc', range };
    expect(await svc.hover('Sub/Main.lean', 1, 9)).toEqual({ contents: 'doc', sourceRange: range });
    client.hoverResult = null;
    expect(await svc.hover('Sub/Main.lean', 1, 9)).toEqual({ contents: null, sourceRange: null });
  });

  it('fails fast while a build is blocking', async () => {
    let blocking = true;
    const svc = service({ buildBlocking: () => blocking });
    await expect(svc.goal('Sub/Main.lean', 1, 1)).rejects.toThrow(BUILD_IN_PROGRESS_MESSAGE);
    expect(created).toBe(0);
    blocking = false;
    await svc.goal('Sub/Main.lean', 1, 1);
    expect(created).toBe(1);
  });

  it('refuses to create a client until ready', async () => {
    const svc = service({
      requireReady: () => {
        throw new Error('not ready');
      },
    });
    await expect(svc.goal('Sub/Main.lean', 1, 1)).rejects.toThrow('not ready');
    expect(created).toBe(0);
  });

  it('discards a dead client and recreates it on the next call', async () => {
    const svc = service();
    await svc.goal('Sub/Main.lean', 1, 1);
    const first = client;
    first.failNext = new LeanProcessExited(137, 'killed');
    await expect(svc.goal('Sub/Main.lean', 1, 1)).rejects.toBeInstanceOf(LeanProcessExited);
    expect(first.closed).toBe(true);
    expect(svc.client).toBeNull();
    await svc.goal('Sub/Main.lean', 1, 1);
    expect(created).toBe(2);
    // An exited client is replaced during the prepare phase as well.
    client.returncode = 1;
    await svc.goal('Sub/Main.lean', 1, 1);
    expect(created).toBe(3);
  });

  it('reloads with dependencyBuildMode once', async () => {
    const svc = service();
    await svc.reloadFile('Sub/Main.lean');
    expect(client.calls).toContainEqual(['reloadDocument', { path: 'Sub/Main.lean', mode: 'once' }]);
  });

  describe('restartClient', () => {
    it('counts as active from the call until the new client is up, so a build can tear it down again', async () => {
      const gate = deferred<void>();
      const svc = service({
        createClient: async () => {
          created += 1;
          if (created === 2) await gate.promise;
          client = new FakeClient(root);
          return client as unknown as LeanLSPClient;
        },
      });
      expect(svc.clientActive).toBe(false);
      await svc.reloadFile('Sub/Main.lean');
      expect(svc.clientActive).toBe(true);
      const first = client;
      const restart = svc.restartClient();
      // Synchronously active, and still so while the new client's handshake runs.
      expect(svc.clientActive).toBe(true);
      await sleep(1);
      expect(first.closed).toBe(true);
      expect(svc.client).toBeNull();
      expect(created).toBe(2);
      expect(svc.clientActive).toBe(true);
      // A build arriving now waits for the handshake to finish and then closes the client.
      const terminate = svc.terminateClient();
      gate.resolve();
      await Promise.all([restart, terminate]);
      expect(client.closed).toBe(true);
      expect(svc.client).toBeNull();
      expect(svc.clientActive).toBe(false);
    });

    it('does not start a server under a build that began meanwhile', async () => {
      let blocking = false;
      const svc = service({ buildBlocking: () => blocking });
      await svc.reloadFile('Sub/Main.lean');
      blocking = true;
      await svc.restartClient();
      expect(created).toBe(1);
      expect(svc.client).toBeNull();
      expect(svc.clientActive).toBe(false);
      blocking = false;
      await svc.restartClient();
      expect(created).toBe(2);
      expect(svc.client).not.toBeNull();
    });
  });

  describe('diagnostics mirroring', () => {
    const file = 'Sub/Main.lean';

    function makeReport(diagnostics: LspDiagnostic[], complete: boolean): DiagnosticReport {
      return { documentVersion: 0, diagnostics, complete, timedOut: !complete, processingRanges: [], hasErrors: diagnostics.some((d) => d.severity === DiagnosticSeverity.Error) };
    }

    it('persists a complete full-file result attested to the source hash and publishes it', async () => {
      const svc = service();
      await svc.goal(file, 1, 1);
      client.report = makeReport([raw('boom', { line: 1, character: 2 }, { line: 1, character: 5 }), raw('hint', { line: 0, character: 0 }, { line: 0, character: 0 }, DiagnosticSeverity.Hint)], true);
      const published: unknown[] = [];
      const result = await svc.diagnostics(file, { onSnapshot: (snapshot) => published.push(snapshot) });
      expect(result.complete).toBe(true);
      expect(result.items.map((item) => item.severity)).toEqual(['error', 'hint']);
      expect(readMatchingFileDiagnostics(root, file)).toEqual([{ file, line: 2, column: 3, severity: 'error', message: 'boom' }]);
      expect(published).toHaveLength(1);
    });

    it('never overwrites the snapshot for incomplete or stale-import results', async () => {
      const svc = service();
      await svc.goal(file, 1, 1);
      const hash = sourceContentHash(join(root, file)) as string;
      replaceSingleFile(root, file, [{ file, line: 9, column: 9, severity: 'error', message: 'known' }], { [file]: hash });
      client.report = makeReport([], false);
      const provisional = await svc.diagnostics(file);
      expect(provisional.complete).toBe(false);
      expect(readSnapshot(root)[file][0].message).toBe('known');
      client.report = makeReport([raw('Imports are out of date and must be rebuilt; use the "Restart File" command in your editor.', { line: 0, character: 0 })], true);
      const stale = await svc.diagnostics(file);
      expect(stale.complete).toBe(false);
      expect(readSnapshot(root)[file][0].message).toBe('known');
    });

    it('merges failed dependencies from a provisional result onto attested diagnostics', async () => {
      const svc = service();
      await svc.goal(file, 1, 1);
      const hash = sourceContentHash(join(root, file)) as string;
      replaceSingleFile(root, file, [{ file, line: 9, column: 9, severity: 'error', message: 'known' }], { [file]: hash });
      client.report = makeReport([raw('error: Dep.lean:1:1: boom', { line: 0, character: 0 })], false);
      const published: unknown[] = [];
      const result = await svc.diagnostics(file, { onSnapshot: (snapshot) => published.push(snapshot) });
      expect(result.failed_dependencies).toEqual(['Dep.lean']);
      expect(readSnapshot(root)[file].map((d) => d.message)).toEqual(['known', `${FAILED_DEPENDENCIES_PREFIX}Dep.lean`]);
      expect(published).toHaveLength(1);
    });

    it('does not attest a file that changed during the query', async () => {
      const svc = service();
      await svc.goal(file, 1, 1);
      const original = client;
      original.diagnostics = async () => {
        writeFileSync(join(root, file), 'changed\n');
        return makeReport([raw('boom', { line: 0, character: 0 })], true);
      };
      await svc.diagnostics(file);
      expect(readSnapshot(root)[file]).toHaveLength(1);
      expect(readMatchingFileDiagnostics(root, file)).toBeNull();
    });

    it('never writes the snapshot for range or declaration queries', async () => {
      const svc = service();
      await svc.goal(file, 1, 1);
      client.report = makeReport([raw('boom', { line: 0, character: 0 })], true);
      await svc.diagnostics(file, { startLine: 1, endLine: 2 });
      expect(readSnapshot(root)).toEqual({});
      const call = client.calls.filter(([name]) => name === 'diagnostics').pop();
      expect((call?.[1] as { options: { range: Range } }).options.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 2 ** 31 - 1 } });
      await expect(svc.diagnostics(file, { declarationName: 'nope' })).rejects.toThrow("Declaration 'nope' not found in file.");
    });
  });
});
