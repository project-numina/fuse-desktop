/**
 * End-to-end: the MCP tools against the real internal routes and the real
 * BlueprintService on a copy of the sample fixture. The MCP client talks to
 * the Hono app in-process (its `fetch` is the app's `fetch`), so this covers
 * the whole chain except the socket: tool call -> HTTP route -> service ->
 * model store and `.tex` tag rewrite.
 *
 * Skipped when the blueprint service or its test context is not importable
 * (they are developed alongside this module).
 */

import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type RepositoryRow } from '@main/store/rows';
import { buildApp } from '@main/server/app';
import { FuseApiClient } from '@mcp/client';
import { createFuseServer } from '@mcp/create-server';
import type { FuseEnv } from '@mcp/env';

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../fixtures/sample-blueprint');
const TOKEN = 'integration-token';

type ServiceModule = typeof import('@main/services/blueprint-service');
type ContextModule = typeof import('@test/main/services/workspace/test-context');

const serviceModule: ServiceModule | null = await import('@main/services/blueprint-service').catch(() => null);
const contextModule: ContextModule | null = await import('@test/main/services/workspace/test-context').catch(() => null);

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('');
}

describe.skipIf(!serviceModule || !contextModule)('fuse MCP tools against the real blueprint service', () => {
  let test: ReturnType<ContextModule['createTestContext']>;
  let repoDir: string;
  let repository: RepositoryRow;
  let service: InstanceType<ServiceModule['BlueprintService']>;
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    test = contextModule!.createTestContext();
    repoDir = join(test.root, 'sample-blueprint');
    cpSync(FIXTURE, repoDir, { recursive: true, filter: (source) => !source.includes(`${join('sample-blueprint', '.lake')}`) });
    git(repoDir, 'init', '-q', '-b', 'main');
    git(repoDir, 'config', 'user.email', 'test@example.com');
    git(repoDir, 'config', 'user.name', 'Test User');
    git(repoDir, 'config', 'commit.gpgsign', 'false');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'initial');
    repository = test.ctx.registry.addRepository(repoDir);
    const now = new Date().toISOString();
    const row: BlueprintRow = {
      id: 'sample',
      repository_id: repository.id,
      title: 'Sample Blueprint',
      description: 'A fixture',
      area: '',
      blueprint_file: null,
      project_subdir: '',
      source_type: 'none',
      source_id: null,
      pr_mode: 'off',
      auto_commit: false,
      orchestrator_child_concurrency: 1,
      agent: { ...DEFAULT_AGENT_CONFIG },
      created_at: now,
      updated_at: now,
    };
    test.ctx.registry.insertBlueprint(row);
    service = new serviceModule!.BlueprintService(test.ctx);
    test.ctx.services.blueprints = service;

    const app = buildApp(test.ctx, TOKEN, null);
    const env: FuseEnv = {
      apiUrl: 'http://127.0.0.1:0',
      apiToken: TOKEN,
      owner: repository.owner,
      repo: repository.name,
      blueprint: 'sample',
      repoPath: repoDir,
      projectRoot: repoDir,
    };
    const fetchViaApp = ((input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(String(input), init))) as typeof fetch;
    const server = createFuseServer({ env, client: new FuseApiClient({ baseUrl: env.apiUrl, token: TOKEN, fetch: fetchViaApp }) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'integration', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await close();
    service.shutdown();
    test.cleanup();
  });

  it('summarises, lists and reads the fixture blueprint', async () => {
    const summary = JSON.parse(textOf(await client.callTool({ name: 'blueprint_get_summary', arguments: {} })));
    expect(summary).toMatchObject({
      name: 'sample',
      blueprint_file: 'blueprint/src/content.tex',
      declaration_count: 6,
      status_counts: { not_started: 1, in_progress: 1, proved: 4 },
    });
    expect((summary.files as Array<{ file: string }>).map((file) => file.file)).toEqual([
      'blueprint/src/content.tex',
      'blueprint/src/chapters/doubling.tex',
      'blueprint/src/chapters/squares.tex',
    ]);

    const listed = JSON.parse(textOf(await client.callTool({ name: 'blueprint_list_declarations', arguments: { file: 'blueprint/src/chapters/squares.tex', status: 'formalized' } })));
    expect(listed.count).toBe(1);
    expect(listed.declarations[0]).toMatchObject({ label: 'thm:twice-le-square', status: 'in_progress' });

    const read = JSON.parse(textOf(await client.callTool({ name: 'blueprint_read_declarations', arguments: { labels: ['twice_eq', 'conj:cube'], fields: ['statement', 'uses', 'leanDeclaration'] } })));
    expect(read.declarations.twice_eq).toMatchObject({ leanDeclaration: 'twice_eq', uses: ['def:twice'] });
    expect(read.declarations['conj:cube'].statement).toMatch(/n\^2 \\le n\^3/);
    expect(read.not_found).toEqual([]);
  });

  it('records agent fields and marks a proof proved with the .tex tags synced', async () => {
    const update = await client.callTool({
      name: 'blueprint_update_declarations',
      arguments: { updates: [{ label: 'thm:twice-le-square', fields: { notes: 'multiply by n', relevantDeclarations: [{ name: 'Nat.mul_le_mul_right', relevance: 'monotone' }] } }, { label: 'conj:cube', fields: { status: 'proved' } }] },
    });
    expect(textOf(update)).toMatch(/^Updated 1 declaration\(s\) in blueprint 'sample': thm:twice-le-square\. Skipped 1 /);

    const status = await client.callTool({ name: 'blueprint_set_declaration_status', arguments: { labels: ['thm:twice-le-square', 'conj:cube'], status: 'proved' } });
    expect(textOf(status)).toBe("Set status of 1 declaration(s) to 'proved': thm:twice-le-square. Skipped: conj:cube (no leanDeclaration; run formalizer).");
    const squares = readFileSync(join(repoDir, 'blueprint/src/chapters/squares.tex'), 'utf8');
    // The proof-block marker goes right after \begin{proof}, ahead of the proof's own \uses.
    expect(squares).toMatch(/\\begin\{proof\}\n\s*\\leanok\n\s*\\uses\{thm:twice-eq\}\n\s*Since \$n \\ge 2\$/);

    const read = JSON.parse(textOf(await client.callTool({ name: 'blueprint_read_declarations', arguments: { labels: 'thm:twice-le-square', fields: ['status', 'notes', 'relevantDeclarations'] } })));
    expect(read.declarations['thm:twice-le-square']).toMatchObject({ status: 'proved', notes: 'multiply by n' });
    expect(read.declarations['thm:twice-le-square'].relevantDeclarations[0].name).toBe('Nat.mul_le_mul_right');
  });

  it('validates and refreshes', async () => {
    const validation = JSON.parse(textOf(await client.callTool({ name: 'blueprint_validate', arguments: {} })));
    expect(validation).toMatchObject({ ok: true, summary: 'Checked 6 declarations across 3 TeX files; found 0 errors and 0 warnings.', checks: { dependency_graph: 'passed' } });
    const refreshed = textOf(await client.callTool({ name: 'blueprint_refresh', arguments: {} }));
    expect(refreshed).toMatch(/^Blueprint 'sample': 6 entries\n {2}- def:twice \(definition\): Doubling/);
  });
});
