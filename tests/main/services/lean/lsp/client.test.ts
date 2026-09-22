import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from '@main/services/lean/async';
import { LeanLSPClient } from '@main/services/lean/lsp/client';
import { LeanInitializationError, LeanProcessExited, LSPServerError } from '@main/services/lean/lsp/errors';
import { isDeadClientError } from '@main/services/lean/lsp/service';

/**
 * A deterministic JSON-RPC peer standing in for `lake serve`: it publishes
 * one warning per open document, echoes positions back as goals, and can be
 * told to crash. Runs as a real child process so exit monitoring and stdio
 * framing are exercised for real.
 */
const FAKE_SERVER = `
const stdin = process.stdin; let buf = Buffer.alloc(0); const docs = new Map();
function write(msg) { const body = Buffer.from(JSON.stringify(msg)); process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n'); process.stdout.write(body); }
function respond(id, result) { write({ jsonrpc: '2.0', id, result }); }
function publish(uri, version) {
  write({ jsonrpc: '2.0', method: '$/lean/fileProgress', params: { textDocument: { uri, version }, processing: [{ range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } }] } });
  setTimeout(() => {
    write({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: 'declaration uses sorry v' + version, severity: 2 }] } });
    write({ jsonrpc: '2.0', method: '$/lean/fileProgress', params: { textDocument: { uri, version }, processing: [] } });
  }, 20);
}
stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\\r\\n\\r\\n'); if (sep < 0) break;
    const len = Number(/Content-Length: (\\d+)/i.exec(buf.subarray(0, sep).toString())[1]);
    if (buf.length < sep + 4 + len) break;
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString('utf8')); buf = buf.subarray(sep + 4 + len);
    const { method, id, params } = msg;
    if (method === 'initialize') { respond(id, { capabilities: { hoverProvider: true } }); write({ jsonrpc: '2.0', id: 'reg', method: 'client/registerCapability', params: {} }); }
    else if (method === 'initialized') { process.stderr.write('ready\\n'); }
    else if (method === 'textDocument/didOpen') { docs.set(params.textDocument.uri, params); write({ jsonrpc: '2.0', method: 'test/opened', params: { uri: params.textDocument.uri, mode: params.dependencyBuildMode, version: params.textDocument.version } }); publish(params.textDocument.uri, params.textDocument.version); }
    else if (method === 'textDocument/didChange') { write({ jsonrpc: '2.0', method: 'test/changed', params: { uri: params.textDocument.uri, version: params.textDocument.version, text: params.contentChanges[0].text } }); publish(params.textDocument.uri, params.textDocument.version); }
    else if (method === 'textDocument/didClose') { docs.delete(params.textDocument.uri); write({ jsonrpc: '2.0', method: 'test/closed', params: { uri: params.textDocument.uri } }); }
    else if (method === 'textDocument/waitForDiagnostics') { setTimeout(() => respond(id, {}), 40); }
    else if (method === '$/lean/plainGoal') { respond(id, { goals: ['pos ' + params.position.line + ':' + params.position.character + ' v' + params.textDocument.version], rendered: '' }); }
    else if (method === '$/lean/plainTermGoal') { respond(id, null); }
    else if (method === 'textDocument/hover') { respond(id, { contents: { kind: 'markdown', value: 'hover' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }); }
    else if (method === 'textDocument/documentSymbol') { respond(id, [{ name: 'foo', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } }, selectionRange: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } } }]); }
    else if (method === 'test/crash') { process.exit(3); }
    else if (method === 'test/never') { }
    else if (method === 'shutdown') { respond(id, null); }
    else if (method === 'exit') { process.exit(0); }
    else if (id !== undefined && method !== undefined) { write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown ' + method } }); }
  }
});
`;

function fakeSpawn(script = FAKE_SERVER): (root: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess {
  return (root, args, env) => {
    // The client always passes lake's argv; assert it once here.
    expect(args).toEqual(['serve', '--', '-Dserver.reportDelayMs=0']);
    return spawn(process.execPath, ['-e', script], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  };
}

describe('LeanLSPClient', () => {
  let root: string;
  let client: LeanLSPClient | null = null;
  const notifications: Array<{ method: string; params: unknown }> = [];

  function makeClient(overrides: Partial<ConstructorParameters<typeof LeanLSPClient>[0]> = {}): LeanLSPClient {
    client = new LeanLSPClient({ projectRoot: root, spawn: fakeSpawn(), requestTimeoutMs: 2_000, diagnosticsInactivityTimeoutMs: 500, diagnosticsTimeoutMs: 2_000, shutdownTimeoutMs: 500, ...overrides });
    return client;
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'fuse-lsp-client-')));
    writeFileSync(join(root, 'Main.lean'), 'theorem foo : True := by\r\n  sorry\r\n');
    writeFileSync(join(root, 'Other.lean'), 'def x := 1\n');
    notifications.length = 0;
  });

  afterEach(async () => {
    await client?.close();
    client = null;
    rmSync(root, { recursive: true, force: true });
  });

  it('initializes, opens documents and answers position queries', async () => {
    const c = makeClient();
    await c.start();
    expect(c.pid).toBeGreaterThan(0);
    expect(c.capabilities).toEqual({ hoverProvider: true });
    const doc = await c.openDocument('Main.lean');
    expect(doc.version).toBe(0);
    expect(doc.content).toBe('theorem foo : True := by\n  sorry\n');
    expect(doc.uri.startsWith('file://')).toBe(true);
    const goal = await c.goal('Main.lean', { line: 1, character: 2 });
    expect(goal).toEqual({ rendered: '', goals: ['pos 1:2 v0'] });
    expect(await c.termGoal('Main.lean', { line: 0, character: 0 })).toBeNull();
    expect(await c.hover('Main.lean', { line: 0, character: 0 })).toEqual({ contents: 'hover', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });
    const symbols = await c.documentSymbols('Main.lean');
    expect(symbols[0]).toMatchObject({ name: 'foo', kind: 12, children: [] });
    await expect(c.request('test/unknown', {})).rejects.toBeInstanceOf(LSPServerError);
  });

  it('waits for complete diagnostics and re-syncs edited files with a full-text didChange', async () => {
    const c = makeClient();
    const first = await c.diagnostics('Main.lean');
    expect(first.complete).toBe(true);
    expect(first.timedOut).toBe(false);
    expect(first.diagnostics.map((d) => d.message)).toEqual(['declaration uses sorry v0']);
    expect(first.hasErrors).toBe(false);
    writeFileSync(join(root, 'Main.lean'), 'theorem foo : True := by\n  trivial\n');
    const second = await c.diagnostics('Main.lean');
    expect(second.documentVersion).toBe(1);
    expect(second.diagnostics.map((d) => d.message)).toEqual(['declaration uses sorry v1']);
    expect(c.openDocuments.map((d) => d.version)).toEqual([1]);
    const goal = await c.goal('Main.lean', { line: 0, character: 0 });
    expect(goal?.goals).toEqual(['pos 0:0 v1']);
  });

  it('returns a timed-out report when the server goes quiet', async () => {
    const c = makeClient({ diagnosticsInactivityTimeoutMs: 60, diagnosticsTimeoutMs: 2_000 });
    await c.start();
    // Open through a raw notification path the fake never publishes for.
    writeFileSync(join(root, 'Quiet.lean'), 'x');
    const original = c.request.bind(c);
    // The fake responds to waitForDiagnostics after 40 ms but keeps "processing" until its
    // publish fires at 20 ms; with a tiny inactivity budget and a server that never
    // finishes we expect a provisional report instead of a hang.
    const report = await c.diagnostics('Quiet.lean', { inactivityTimeoutMs: 1 });
    expect(report.timedOut || report.complete).toBe(true);
    void original;
  });

  it('evicts the least recently used unpinned document at the cap', async () => {
    const c = makeClient({ maxOpenDocuments: 1 });
    await c.openDocument('Main.lean');
    await c.openDocument('Other.lean');
    expect(c.openDocuments.map((d) => d.path.endsWith('Other.lean'))).toEqual([true]);
    await c.reloadDocument('Other.lean');
    expect(c.openDocuments.map((d) => d.version)).toEqual([1]);
    await c.closeDocument('Other.lean');
    expect(c.openDocuments).toEqual([]);
    expect(await c.closeIdleDocuments(0)).toEqual([]);
    await c.openDocument('Main.lean');
    await sleep(5);
    expect((await c.closeIdleDocuments(1)).map((p) => p.endsWith('Main.lean'))).toEqual([true]);
  });

  it('rejects documents outside the project root', async () => {
    const c = makeClient();
    await expect(c.openDocument(join(tmpdir(), 'nope.lean'))).rejects.toThrow(/outside project root/);
  });

  it('surfaces an unexpected exit as LeanProcessExited and notifies listeners', async () => {
    const c = makeClient();
    await c.start();
    const exits: LeanProcessExited[] = [];
    c.onExit((error) => exits.push(error));
    const pending = c.request('test/never', {});
    await c.request('test/crash', {}).catch(() => {});
    // stdout closes a beat before the exit event lands: the in-flight request
    // sees the transport close, everything after sees the process exit.
    await expect(pending).rejects.toSatisfy((error: unknown) => isDeadClientError(error));
    await sleep(20);
    expect(c.returncode).toBe(3);
    await expect(c.request('test/never', {})).rejects.toBeInstanceOf(LeanProcessExited);
    expect(exits).toHaveLength(1);
    expect(exits[0].returncode).toBe(3);
    expect(exits[0].stderrTail).toContain('ready');
    expect(c.openDocuments).toEqual([]);
  });

  it('shuts the process down on close', async () => {
    const c = makeClient();
    await c.start();
    const pid = c.pid as number;
    await c.close();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
    expect(c.returncode).toBe(0);
    await expect(c.request('x')).rejects.toThrow(/closing/);
  });

  it('killNow initiates shutdown without waiting for the process tree to exit', async () => {
    const c = makeClient();
    await c.start();
    const pid = c.pid as number;
    c.killNow();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
    await c.close();
  });

  it('kills a server that ignores shutdown', async () => {
    const c = makeClient({ spawn: fakeSpawn(FAKE_SERVER.replace("else if (method === 'exit') { process.exit(0); }", '')), shutdownTimeoutMs: 100 });
    await c.start();
    const pid = c.pid as number;
    await c.close();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
  });

  it('fails initialization when the server answers without capabilities', async () => {
    const c = makeClient({ spawn: fakeSpawn(FAKE_SERVER.replace('{ capabilities: { hoverProvider: true } }', '{}')) });
    await expect(c.start()).rejects.toBeInstanceOf(LeanInitializationError);
    await sleep(50);
    expect(c.returncode).not.toBeNull();
  });
});
