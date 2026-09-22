import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlueprintCommitResult, ConversationLiveSession, SessionHistoryDetail, SessionResponse } from '@shared/api-types';
import { appPaths } from '@main/paths';
import { buildApp } from '@main/server/app';
import type { AppContext } from '@main/server/context';
import type { SseFrame } from '@main/server/sse';
import { SseRooms } from '@main/server/sse';
import { SettingsStore } from '@main/settings';
import { Registry } from '@main/store/registry';
import { DEFAULT_AGENT_CONFIG, type BlueprintRow, type RepositoryRow } from '@main/store/rows';
import { claudeMessages, type NativeHistory } from '@main/services/sessions/native-history';
import { SessionService, type SessionServiceOptions } from '@main/services/sessions/index';
import { ScriptedThread, fakeBlueprint, flushAsync, waitFor } from '@test/main/services/sessions/test-helpers';

const commitChanges = vi.fn<(cwd: string, opts: Record<string, unknown>) => Promise<BlueprintCommitResult>>();
vi.mock('@main/services/git', () => ({ commitChanges: (cwd: string, opts: Record<string, unknown>) => commitChanges(cwd, opts) }));

const TOKEN = 'test-token';

interface World {
  ctx: AppContext;
  service: SessionService;
  repository: RepositoryRow;
  threads: ScriptedThread[];
  attention: ReturnType<typeof vi.fn>;
  startBuild: ReturnType<typeof vi.fn>;
  request(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>;
  frames(sessionId: string): SseFrame[];
  dirs: string[];
}

interface WorldOptions {
  nativeHistory?: SessionServiceOptions['nativeHistory'];
  autoCommit?: boolean;
  lean?: boolean;
  idleTimeoutMs?: number;
  activityTimeoutMs?: number;
  /** Reuse an earlier world's data directory (a restart of the app). */
  dataDir?: string;
  repoDir?: string;
  blueprint?: Partial<BlueprintRow>;
  providerStateExists?: SessionServiceOptions['providerStateExists'];
  services?: Record<string, unknown>;
}

function makeWorld(options: WorldOptions = {}): World {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'fuse-sessions-data-'));
  const repoDir = options.repoDir ?? mkdtempSync(join(tmpdir(), 'fuse-sessions-repo-'));
  mkdirSync(join(repoDir, 'Sample'), { recursive: true });
  writeFileSync(join(repoDir, 'Sample', 'Basic.lean'), 'theorem t : True := trivial\n');
  writeFileSync(join(repoDir, 'lakefile.toml'), 'name = "sample"\n[[lean_lib]]\nname = "Sample"\n');
  const paths = appPaths(dataDir);
  const registry = new Registry(paths);
  const repository = registry.getRepositoryById(1) ?? registry.addRepository(repoDir);
  if (!registry.getBlueprint(repository.id, 'sample')) {
    registry.insertBlueprint(fakeBlueprint({ repository_id: repository.id, id: 'sample', auto_commit: options.autoCommit === true, ...(options.blueprint ?? {}) }));
  }
  const attention = vi.fn();
  const startBuild = vi.fn(async () => ({ status: 'ok', output: null, error: null }));
  const ctx: AppContext = {
    paths,
    registry,
    settings: new SettingsStore(join(dataDir, 'settings.json')),
    blueprintRooms: new SseRooms(() => ({})),
    sessionRooms: new SseRooms(() => ({})),
    resourcesDir: join(dataDir, 'resources'),
    server: { baseUrl: 'http://127.0.0.1:4321', token: 'api-token' },
    services: { attention: { observe: attention }, ...(options.services ?? {}) },
  };
  const threads: ScriptedThread[] = [];
  const service = new SessionService(ctx, {
    nativeHistory: options.nativeHistory,
    createThread: (launch, sink) => {
      const thread = new ScriptedThread(launch, sink);
      threads.push(thread);
      return thread;
    },
    mcpServerPath: '/app/out/main/mcp-server.js',
    stopWaitMs: 50,
    interruptGraceMs: 200,
    endedRetentionMs: 5_000,
    idleTimeoutMs: options.idleTimeoutMs,
    activityTimeoutMs: options.activityTimeoutMs,
    // Tests never scan the real home directory for CLI session files.
    providerStateExists: options.providerStateExists ?? (() => true),
  });
  const app = buildApp(ctx, TOKEN, null);
  // The Lean and blueprint route factories register their real services in
  // buildApp; the tests stand in a scripted Lean service after that.
  ctx.services.lean = options.lean
    ? {
        buildStatus: () => ({ status: 'not_built', head: null, toolchain_hash: null, manifest_hash: null }),
        buildSnapshot: () => ({ status: 'running', steps: [{ phase: 'building', message: 'Building Lean project...' }] }),
        startBuild,
      }
    : undefined;
  return {
    ctx,
    service,
    repository,
    threads,
    attention,
    startBuild,
    dirs: [dataDir, repoDir],
    request: async (path, init = {}) =>
      app.request(`/api/sessions${path}`, {
        method: init.method ?? 'GET',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      }),
    frames: (sessionId) => ctx.sessionRooms.peek(sessionId)?.replayAfter(null) ?? [],
  };
}

async function createSession(world: World, message = 'Prove it', extra: Record<string, unknown> = {}): Promise<{ response: SessionResponse; thread: ScriptedThread }> {
  const res = await world.request('', {
    method: 'POST',
    body: { repository_owner: world.repository.owner, repository_name: world.repository.name, blueprint_name: 'sample', initial_message: message, ...extra },
  });
  expect(res.status).toBe(200);
  const response = (await res.json()) as SessionResponse;
  await flushAsync();
  return { response, thread: world.threads[world.threads.length - 1] };
}

let world: World;

beforeEach(() => {
  commitChanges.mockReset();
  ScriptedThread.steerable = true;
  world = makeWorld();
});

afterEach(async () => {
  await world.service.shutdown();
  await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
  world.ctx.registry.flushSync();
  for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
});

describe('native history integration', () => {
  async function nativeWorld(nested = false) {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    const messages = claudeMessages([
      { uuid: 'u', type: 'user', message: { content: 'A native question' } },
      { uuid: 'a', type: 'assistant', message: { content: 'A native answer' } },
    ]);
    const native: NativeHistory = { list: vi.fn(async () => ({ sessions: [{ provider: 'codex' as const, threadId: 'provider-123', directory: nested ? join(world.repository.path, 'nested') : world.repository.path, title: 'Native chat', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }], errors: [] })), read: vi.fn(async () => messages.map((row) => ({ ...row }))) };
    world = makeWorld({ nativeHistory: native, blueprint: nested ? { project_subdir: 'nested' } : undefined });
    if (nested) mkdirSync(join(world.repository.path, 'nested'), { recursive: true });
    const url = `/history?repository_owner=${world.repository.owner}&repository_name=${world.repository.name}&blueprint_name=sample`;
    await world.request(url);
    await vi.waitFor(() => expect(world.service.nativeHistoryRefreshing(world.repository.owner, world.repository.name, 'sample')).toBe(false));
    return { native, url };
  }

  it('returns indexed chats without waiting for a slow native refresh and coalesces requests', async () => {
    const { native, url } = await nativeWorld();
    let finish!: (result: Awaited<ReturnType<NativeHistory['list']>>) => void;
    vi.mocked(native.list).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const list = await (await world.request(url)).json();
    expect(list).toHaveLength(1);
    expect(world.service.nativeHistoryRefreshing(world.repository.owner, world.repository.name, 'sample')).toBe(true);
    const calls = vi.mocked(native.list).mock.calls.length;
    await world.request(url);
    await world.request(`${url}&offset=20`);
    expect(native.list).toHaveBeenCalledTimes(calls);
    finish({ sessions: [], errors: ['Provider unavailable'] });
    await vi.waitFor(() => expect(world.service.nativeHistoryRefreshing(world.repository.owner, world.repository.name, 'sample')).toBe(false));
    expect(await (await world.request(`${url}&refresh_native=false`)).json()).toHaveLength(1);
    expect(native.list).toHaveBeenCalledTimes(calls);
    expect(world.service.nativeHistoryWarnings(world.repository.owner, world.repository.name, 'sample')).toEqual(['Provider unavailable']);
  });

  it('discovers native sessions without copying transcripts, deduplicates them, and resumes the original provider', async () => {
    const { native, url } = await nativeWorld();
    const list = await (await world.request(url)).json() as SessionHistoryDetail[];
    expect(list).toHaveLength(1);
    const id = list[0].id;
    expect(world.service.attentionState()[0]).toMatchObject({ id, unread: false, state: 'idle' });
    expect(world.service.store.get(id)?.messages).toEqual([]);
    expect(native.read).not.toHaveBeenCalled();
    expect(await (await world.request(url)).json()).toHaveLength(1);
    const detail = await (await world.request(`/history/${id}`)).json() as SessionHistoryDetail;
    expect(detail.messages.map((row) => row.content)).toEqual(['A native question', 'A native answer']);
    const { thread } = await createSession(world, 'Continue', { resume_from_conversation_id: id });
    expect(thread.launch.config.provider).toBe('codex');
    expect(thread.launch.providerThreadId).toBe('provider-123');
    expect(thread.launch.repoPath).toBe(world.repository.path);
    world.service.store.flushSync();
    const disk = JSON.parse(readFileSync(world.ctx.paths.conversationFile(id), 'utf8'));
    expect(disk.messages.some((row: { content: string }) => row.content === 'A native answer')).toBe(false);
    expect(disk.messages.some((row: { content: string }) => row.content === 'Continue')).toBe(true);
  });

  it('hides native chats without deleting provider history or rediscovering them', async () => {
    const { native, url } = await nativeWorld();
    const [chat] = await (await world.request(url)).json() as SessionHistoryDetail[];
    expect((await world.request(`/history/${chat.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await world.request(url)).json()).toEqual([]);
    expect((await world.request(`/history/${chat.id}`)).status).toBe(404);
    expect(native.read).not.toHaveBeenCalled();
    expect(world.service.store.get(chat.id)?.nativeRef?.threadId).toBe('provider-123');
  });

  it('continues a native subfolder session in its original directory', async () => {
    const { url } = await nativeWorld(true);
    const [chat] = await (await world.request(url)).json() as SessionHistoryDetail[];
    const { thread } = await createSession(world, 'Continue', { resume_from_conversation_id: chat.id });
    const directory = join(world.repository.path, 'nested');
    expect(thread.launch.repoPath).toBe(directory);
    expect(thread.launch.providerThreadId).toBe('provider-123');
    expect(thread.sends[0].text).toContain(`The working directory is ${directory}.`);
  });

  it('reports unreadable native history without starting a fresh chat or deleting the reference', async () => {
    const { native, url } = await nativeWorld();
    const [chat] = await (await world.request(url)).json() as SessionHistoryDetail[];
    vi.mocked(native.read).mockRejectedValue(new Error('native file missing'));
    expect((await world.request(`/history/${chat.id}`)).status).toBe(503);
    const resumed = await world.request('', { method: 'POST', body: { repository_owner: world.repository.owner, repository_name: world.repository.name, blueprint_name: 'sample', initial_message: 'Continue', resume_from_conversation_id: chat.id } });
    expect(resumed.status).toBe(503);
    expect(world.threads).toHaveLength(0);
    expect(world.service.store.get(chat.id)).not.toBeNull();
  });
});

describe('POST /sessions', () => {
  it('creates the conversation, answers before the turn starts, then launches the CLI with the fuse MCP server', async () => {
    const { response, thread } = await createSession(world);
    expect(response).toMatchObject({
      status: 'starting',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'not_started',
      // turn_active from creation, like the web's Session(turn_active=True).
      display_status: 'Running autonomously.',
      active_work_group_count: 0,
      api_key_fallback_pending: false,
    });
    expect(response.session_id).not.toBe(response.conversation_id);
    const row = world.ctx.registry.getConversation(response.conversation_id);
    expect(row).toMatchObject({ title: 'Prove it', status: 'running', blueprint_id: 'sample', repository_id: world.repository.id, provider: 'claude' });

    expect(thread.launch.repoPath).toBe(world.repository.path);
    // The CLI's own environment carries no credentials: every shell command
    // the agent runs inherits it. The MCP server gets them through its config.
    expect(thread.launch.env).toEqual({ MCP_TOOL_TIMEOUT: '600000' });
    const claude = thread.launch.claude!;
    expect(claude.allowedTools).toEqual(['mcp__fuse', 'Task']);
    expect(claude.disallowedTools).toEqual(['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete', 'AskUserQuestion']);
    expect(claude.maxTurns).toBe(200);
    expect(claude.systemPromptFile).toContain(join('prompts', response.conversation_id, 'system.md'));
    expect(claude.mcpConfigJson).toBeUndefined();
    expect(claude.mcpConfigFile).toBe(join(world.ctx.paths.dataDir, 'prompts', response.conversation_id, 'mcp.json'));
    if (process.platform !== 'win32') expect(statSync(claude.mcpConfigFile!).mode & 0o777).toBe(0o600);
    const mcp = JSON.parse(readFileSync(claude.mcpConfigFile!, 'utf8')) as { mcpServers: { fuse: { command: string; args: string[]; env: Record<string, string> } } };
    expect(mcp.mcpServers.fuse.command).toBe(process.execPath);
    expect(mcp.mcpServers.fuse.args).toEqual(['/app/out/main/mcp-server.js']);
    expect(mcp.mcpServers.fuse.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      FUSE_API_URL: 'http://127.0.0.1:4321',
      FUSE_API_TOKEN: 'api-token',
      FUSE_OWNER: world.repository.owner,
      FUSE_REPO: world.repository.name,
      FUSE_BLUEPRINT: 'sample',
      FUSE_PROJECT_ROOT: world.repository.path,
      FUSE_REPO_PATH: world.repository.path,
    });

    expect(thread.sends).toHaveLength(1);
    const prompt = thread.sends[0].text;
    expect(prompt).toContain(`You are working on the blueprint 'sample' in ${world.repository.owner}/${world.repository.name}.`);
    expect(prompt).toContain('reason: session start');
    expect(prompt.endsWith('User message: Prove it')).toBe(true);

    expect(world.frames(response.session_id).map((frame) => [frame.event, frame.data])).toEqual([
      ['chat', { role: 'user', content: 'Prove it' }],
      ['session_status', { status: 'running' }],
      ['turn_status', { turn_active: true }],
    ]);
  });

  it('rejects unknown blueprints and empty messages', async () => {
    const missing = await world.request('', {
      method: 'POST',
      body: { repository_owner: world.repository.owner, repository_name: world.repository.name, blueprint_name: 'nope', initial_message: 'x' },
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ detail: 'Blueprint not found' });
    const empty = await world.request('', {
      method: 'POST',
      body: { repository_owner: world.repository.owner, repository_name: world.repository.name, blueprint_name: 'sample', initial_message: '  ' },
    });
    expect(empty.status).toBe(422);
  });
});

describe('a turn', () => {
  it('tracks unread responses per chat, rejects stale receipts, and restores them after restart', async () => {
    const { response, thread } = await createSession(world);
    const badge = vi.fn();
    world.ctx.services.attention = { observe: vi.fn(), setUnread: badge };
    expect(world.service.attentionState()[0]).toMatchObject({ unread: false, state: 'running' });
    thread.text('First answer');
    thread.complete();
    await flushAsync();
    const first = world.service.attentionState()[0];
    expect(first).toMatchObject({ unread: true, state: 'idle' });
    expect(badge).toHaveBeenLastCalledWith([response.conversation_id]);
    const seen = await world.request(`/history/${response.conversation_id}/seen`, { method: 'POST', body: { revision: first.revision } });
    expect(seen.status).toBe(204);
    expect(world.service.attentionState()[0].unread).toBe(false);
    expect(badge).toHaveBeenLastCalledWith([]);
    const other = await createSession(world, 'Another chat');
    other.thread.text('Other answer');
    other.thread.complete();
    await flushAsync();
    expect(world.service.attentionState().find((entry) => entry.id === other.response.conversation_id)?.unread).toBe(true);
    await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'More' } });
    thread.text('Second answer');
    thread.complete();
    await flushAsync();
    expect(world.service.attentionState().find((entry) => entry.id === response.conversation_id)?.unread).toBe(true);
    const stale = await world.request(`/history/${response.conversation_id}/seen`, { method: 'POST', body: { revision: first.revision } });
    expect(stale.status).toBe(409);
    expect(world.service.attentionState()[0].unread).toBe(true);
    await world.service.shutdown();
    const [dataDir, repoDir] = world.dirs;
    const restarted = makeWorld({ dataDir, repoDir });
    try {
      expect(restarted.service.attentionState()[0].unread).toBe(true);
      restarted.service.markSeen(response.conversation_id, restarted.service.attentionState()[0].revision);
      expect(restarted.service.attentionState()[0].unread).toBe(false);
    } finally { await restarted.service.shutdown(); }
  });

  it('streams the reply, persists rows the history endpoint reconstructs with matching ids, and stays running', async () => {
    const { response, thread } = await createSession(world);
    thread.start('provider-1');
    thread.text('Looking');
    thread.toolCall('toolu_1', 'Read', { file_path: 'Sample/Basic.lean' });
    thread.toolResult('toolu_1', 'theorem t');
    thread.text('Done <suggest>Prove B</suggest>', 'block-2');
    thread.complete(0.02);
    await flushAsync();

    const events = world.frames(response.session_id).map((frame) => frame.event);
    expect(events).toEqual([
      'chat',
      'session_status',
      'turn_status',
      'stream_start',
      'stream_delta',
      'stream_end',
      'chat',
      'tool_call',
      'tool_result',
      'stream_start',
      'stream_delta',
      'stream_end',
      'chat',
      'session_result',
      'turn_status',
    ]);
    const chats = world.frames(response.session_id).filter((frame) => frame.event === 'chat');
    expect(chats[1].data).toEqual({ role: 'agent', content: 'Looking', assistant_turn_id: 'turn-0:assistant-0' });
    expect(chats[2].data).toEqual({ role: 'agent', content: 'Done <suggest>Prove B</suggest>', assistant_turn_id: 'turn-0:assistant-1' });

    const live = (await (await world.request(`/history/${response.conversation_id}/live`)).json()) as ConversationLiveSession;
    expect(live).toMatchObject({
      session_id: response.session_id,
      status: 'running',
      turn_active: false,
      can_send: true,
      can_cancel: true,
      display_status: 'Ready for messages.',
      execution_mode: 'background',
      user_stop_requested: false,
    });
    expect(live.event_counter).toBe(15);
    expect(live.last_persisted_event_id).toBe(13);

    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.status).toBe('running');
    expect(detail.tier).toBe('waiting_for_review');
    expect(detail.can_resume).toBe(true);
    expect(detail.subagent_history_lazy).toBe(true);
    expect(detail.last_persisted_event_id).toBe(13);
    expect(detail.messages.map((row) => row.role)).toEqual(['user', 'agent', 'tool', 'tool', 'agent']);
    expect(detail.messages[1].content).toBe('Looking');
    expect(JSON.parse(detail.messages[2].content)).toMatchObject({ kind: 'tool_call', tool: 'Read', tool_use_id: 'toolu_1' });
    expect(detail.total_cost_usd).toBeCloseTo(0.02);

    const state = await (await world.request(`/${response.session_id}/state`)).json();
    expect(state).toMatchObject({ status: 'running', turn_active: false, event_counter: 15 });
    expect((state as { messages: unknown[] }).messages).toHaveLength(3);
    expect(world.ctx.registry.getConversation(response.conversation_id)?.provider_thread_id).toBe('provider-1');
    expect(world.attention).toHaveBeenCalledWith(response.conversation_id, expect.objectContaining({ kind: 'turn_completed' }));

    const active = await (await world.request('/active')).json();
    expect(active).toMatchObject({ active_count: 1, max_active_sessions: 0 });
    expect((active as { sessions: Array<Record<string, unknown>> }).sessions[0]).toMatchObject({
      session_id: response.session_id,
      blueprint_name: 'sample',
      workspace_label: 'sample',
      display_status: 'Ready for messages.',
    });
  });

  it('marks the workspace busy only while work is pending', async () => {
    const { thread } = await createSession(world);
    expect(world.service.isBlueprintBusy(world.repository.id, 'sample')).toBe(true);
    thread.complete();
    await flushAsync();
    expect(world.service.isBlueprintBusy(world.repository.id, 'sample')).toBe(false);
    expect(world.service.activeSessionsForRepository(world.repository.id)).toEqual([
      expect.objectContaining({ blueprint_name: 'sample', title: 'Prove it', tier: 'waiting_for_review', background_updates: [], roadblocks: [] }),
    ]);
  });

  it('ends the session as failed when the provider dies', async () => {
    const { response, thread } = await createSession(world);
    thread.fail('Claude Code exited unexpectedly (exit code 1).');
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    const frames = world.frames(response.session_id);
    expect(frames.slice(-3).map((frame) => [frame.event, frame.data])).toEqual([
      ['error', { message: 'Claude Code exited unexpectedly (exit code 1).' }],
      ['turn_status', { turn_active: false }],
      ['session_end', { status: 'failed' }],
    ]);
    expect(thread.closed).toBe(true);
    expect((await world.request(`/history/${response.conversation_id}/live`)).status).toBe(404);
    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.status).toBe('failed');
    const state = await world.request(`/${response.session_id}/state`);
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ status: 'failed', display_status: 'Session failed.' });
  });
});

describe('POST /sessions/:id/messages', () => {
  it('starts a follow-up turn at once when the session is idle', async () => {
    const { response, thread } = await createSession(world);
    thread.text('First answer');
    thread.complete();
    await flushAsync();
    const res = await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'Now prove B' } });
    expect(res.status).toBe(200);
    const accepted = (await res.json()) as { status: string; message_id: string; delivery_state: string };
    expect(accepted).toMatchObject({ status: 'accepted', delivery_state: 'queued' });
    await flushAsync();
    const frames = world.frames(response.session_id);
    const tail = frames.slice(-5).map((frame) => [frame.event, frame.data]);
    expect(tail).toEqual([
      ['turn_status', { turn_active: false }],
      ['chat', { role: 'user', content: 'Now prove B', message_id: accepted.message_id, delivery_state: 'queued' }],
      ['turn_status', { turn_active: true }],
      ['message_delivery', { message_id: accepted.message_id, state: 'delivered' }],
      ['turn_status', { turn_active: true }],
    ]);
    expect(thread.sends).toHaveLength(2);
    expect(thread.sends[1].text).toContain('reason: follow-up user turn');
    expect(thread.sends[1].text.endsWith('User message: Now prove B')).toBe(true);

    thread.text('Second answer');
    const chat = world.frames(response.session_id).filter((frame) => frame.event === 'chat').pop();
    expect(chat?.data).toMatchObject({ assistant_turn_id: 'turn-2:assistant-0' });
    thread.complete();
    await flushAsync();
    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.messages.map((row) => [row.role, row.content, row.delivery_state])).toEqual([
      ['user', 'Prove it', null],
      ['agent', 'First answer', null],
      ['user', 'Now prove B', 'delivered'],
      ['agent', 'Second answer', null],
    ]);
  });

  it('steers a running Claude turn and drains several waiting messages into one follow-up turn', async () => {
    const { response, thread } = await createSession(world);
    const steer = (await (await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'also do X' } })).json()) as { message_id: string };
    expect(thread.steers).toHaveLength(0);
    thread.toolCall('toolu_1', 'Read', { file_path: 'Sample/Basic.lean' });
    expect(thread.steers).toHaveLength(1);
    expect(thread.steers[0]).toContain('User message: also do X');
    thread.toolResult('toolu_1');
    thread.text('Got it');
    expect(world.frames(response.session_id).find((frame) => frame.event === 'message_delivery')?.data).toEqual({ message_id: steer.message_id, state: 'steered' });
    // A message accepted while a tool call is already outstanding is written at once.
    thread.toolCall('toolu_2', 'Bash', { command: 'lake build' });
    await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'while building' } });
    expect(thread.steers).toHaveLength(2);
    expect(thread.steers[1]).toContain('User message: while building');
    thread.toolResult('toolu_2');
    thread.text('Built');
    // A steer accepted with no later tool call goes back to the queue at turn end.
    const late = (await (await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'late one' } })).json()) as { message_id: string };
    const later = (await (await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'later one' } })).json()) as { message_id: string };
    thread.complete();
    await flushAsync();
    expect(thread.sends).toHaveLength(2);
    expect(thread.sends[1].text).toContain('User message: late one');
    expect(thread.sends[1].text).toContain('\n\nUser message: later one');
    const deliveries = world.frames(response.session_id).filter((frame) => frame.event === 'message_delivery').map((frame) => frame.data);
    expect(deliveries).toEqual([
      { message_id: steer.message_id, state: 'steered' },
      { message_id: expect.any(String), state: 'steered' },
      { message_id: late.message_id, state: 'queued' },
      { message_id: later.message_id, state: 'queued' },
      { message_id: late.message_id, state: 'delivered' },
      { message_id: later.message_id, state: 'delivered' },
    ]);
  });

  it('queues for the next turn when the provider cannot steer', async () => {
    ScriptedThread.steerable = false;
    const { response, thread } = await createSession(world);
    await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'queued one' } });
    thread.toolCall('toolu_1', 'Read', {});
    expect(thread.steers).toHaveLength(0);
    thread.toolResult('toolu_1');
    thread.complete();
    await flushAsync();
    expect(thread.sends).toHaveLength(2);
    expect(thread.sends[1].text.endsWith('User message: queued one')).toBe(true);
  });

  it('caps the queue at eight and rejects unknown or finished sessions', async () => {
    ScriptedThread.steerable = false;
    const { response, thread } = await createSession(world);
    for (let index = 0; index < 8; index += 1) {
      expect((await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: `m${index}` } })).status).toBe(200);
    }
    const full = await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'one too many' } });
    expect(full.status).toBe(429);
    expect(await full.json()).toMatchObject({ detail: '8 messages are already waiting for the agent. Wait for it to work through them before sending more.' });
    expect((await world.request('/nope/messages', { method: 'POST', body: { content: 'x' } })).status).toBe(404);
    thread.fail();
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    const ended = await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'x' } });
    expect(ended.status).toBe(400);
    expect(await ended.json()).toMatchObject({ detail: 'Session is not running (status: failed)' });
  });
});

describe('POST /sessions/:id/cancel', () => {
  it('interrupts the turn, retains queued messages, ends the session and lets the next create resume it', async () => {
    const { response, thread } = await createSession(world);
    thread.start('provider-1');
    thread.text('Working on it');
    const queued = (await (await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'wait, also' } })).json()) as { message_id: string };
    const cancelPromise = world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await flushAsync();
    expect(thread.interrupts).toBe(1);
    thread.interrupted();
    const cancel = await (await cancelPromise).json();
    expect(cancel).toEqual({ status: 'stop_requested', message_delivery_states: { [queued.message_id]: 'retained' } });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    const frames = world.frames(response.session_id);
    expect(frames.slice(-3).map((frame) => [frame.event, frame.data])).toEqual([
      ['turn_status', { turn_active: false }],
      ['message_delivery', { message_id: queued.message_id, state: 'retained' }],
      ['session_end', { status: 'cancelled' }],
    ]);
    expect(thread.closed).toBe(true);
    expect(world.ctx.sessionRooms.peek(response.session_id)?.isClosed).toBe(true);
    expect((await world.request(`/history/${response.conversation_id}/live`)).status).toBe(404);
    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.status).toBe('cancelled');
    expect(detail.messages.map((row) => [row.role, row.delivery_state])).toEqual([
      ['user', null],
      ['agent', null],
      ['user', 'retained'],
    ]);
    // Cancelling again is harmless; a message now fails.
    expect((await world.request(`/${response.session_id}/cancel`, { method: 'POST' })).status).toBe(200);
    expect((await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'x' } })).status).toBe(400);

    const resumed = await createSession(world, 'go on', { resume_from_conversation_id: response.conversation_id });
    expect(resumed.response.conversation_id).toBe(response.conversation_id);
    expect(resumed.response.session_id).not.toBe(response.session_id);
    expect(resumed.thread).not.toBe(thread);
    // A retained message may or may not have reached the model: the web
    // starts a fresh provider thread with the transcript replayed rather
    // than resume one that would see the steer a second time.
    expect(resumed.thread.launch.providerThreadId).toBeNull();
    const prompt = resumed.thread.sends[0].text;
    expect(prompt).toContain('continuation of an earlier chat session');
    expect(prompt).toContain('User: Prove it\nAgent: Working on it');
    expect(prompt).toContain('The user sent the messages below before stopping the previous run.');
    expect(prompt).toContain('User: wait, also');
    expect(prompt.endsWith('User message: go on')).toBe(true);
    // The retained row is consumed once the new turn starts, keeping its place.
    expect(world.frames(resumed.response.session_id).map((frame) => [frame.event, frame.data])).toEqual([
      ['chat', { role: 'user', content: 'go on' }],
      ['session_status', { status: 'running' }],
      ['turn_status', { turn_active: true }],
      ['message_delivery', { message_id: queued.message_id, state: 'delivered' }],
    ]);
    resumed.thread.text('Continuing');
    const chat = world.frames(resumed.response.session_id).filter((frame) => frame.event === 'chat').pop();
    // Rows: user, agent, retained user (delivered), new user -> turn-3.
    expect(chat?.data).toMatchObject({ assistant_turn_id: 'turn-3:assistant-0' });
    const conversation = world.ctx.registry.getConversation(response.conversation_id);
    expect(conversation?.status).toBe('running');
  });

  it('ends an idle session immediately and answers a create with a live conversation by queueing onto it', async () => {
    const { response, thread } = await createSession(world);
    thread.complete();
    await flushAsync();
    const again = await createSession(world, 'second', { resume_from_conversation_id: response.conversation_id });
    expect(again.response.session_id).toBe(response.session_id);
    expect(again.thread).toBe(thread);
    expect(thread.sends).toHaveLength(2);
    expect(thread.sends[1].text.endsWith('User message: second')).toBe(true);
    thread.complete();
    await flushAsync();
    const cancel = await (await world.request(`/${response.session_id}/cancel`, { method: 'POST' })).json();
    expect(cancel).toEqual({ status: 'stop_requested', message_delivery_states: expect.any(Object) });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    expect(world.frames(response.session_id).pop()).toMatchObject({ event: 'session_end', data: { status: 'cancelled' } });
  });

  it('kills a provider that ignores the interrupt', async () => {
    const { response, thread } = await createSession(world);
    await world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    expect(thread.closed).toBe(true);
    expect(world.frames(response.session_id).pop()).toMatchObject({ event: 'session_end', data: { status: 'cancelled' } });
  });
});

describe('permissions', () => {
  it('forwards the prompt and the decision', async () => {
    const { response, thread } = await createSession(world);
    thread.push({
      kind: 'permission_request',
      turnId: thread.turnId,
      requestId: 'req-1',
      toolCallId: 'toolu_1',
      tool: 'Bash',
      input: { command: 'lake build' },
      description: 'lake build',
      reason: null,
      suggestions: [],
      at: Date.now(),
    });
    expect(world.frames(response.session_id).pop()).toMatchObject({ event: 'permission_request', data: { request_id: 'req-1', tool: 'Bash', assistant_turn_id: 'turn-0:assistant-0' } });
    expect(world.service.attentionState()[0].state).toBe('needs_input');
    const res = await world.request(`/${response.session_id}/permissions/req-1`, { method: 'POST', body: { behavior: 'allow', suggestion: { type: 'addRules' } } });
    expect(res.status).toBe(200);
    expect(thread.permissionResponses).toEqual([{ requestId: 'req-1', decision: { behavior: 'allow', suggestion: { type: 'addRules' } } }]);
    expect(world.service.attentionState()[0].state).toBe('running');
    expect(world.frames(response.session_id).pop()).toMatchObject({ event: 'permission_resolved', data: { request_id: 'req-1', behavior: 'allow' } });
    expect((await world.request(`/${response.session_id}/permissions/req-1`, { method: 'POST', body: { behavior: 'maybe' } })).status).toBe(422);
  });
});

describe('history endpoints', () => {
  it('lists by blueprint, lists recent chats, serves subagent timelines and deletes', async () => {
    const { response, thread } = await createSession(world);
    thread.toolCall('task_1', 'Task', { description: 'prove A', subagent_type: 'prover' });
    thread.push({ kind: 'agent_status', turnId: thread.turnId, toolCallId: 'task_1', agent: 'prover', status: 'running', at: Date.now() });
    thread.toolCall('sub_1', 'Read', { file_path: 'Sample/Basic.lean' }, 'task_1');
    thread.toolResult('sub_1');
    thread.push({ kind: 'subagent_text_completed', turnId: thread.turnId, parentToolCallId: 'task_1', text: 'Proved', messageId: 'm', at: Date.now() });
    thread.push({ kind: 'agent_status', turnId: thread.turnId, toolCallId: 'task_1', agent: 'prover', status: 'completed', at: Date.now() });
    thread.toolResult('task_1', 'PROVED');
    thread.text('All done');
    thread.complete();
    await flushAsync();

    const list = (await (
      await world.request(`/history?repository_owner=${world.repository.owner}&repository_name=${world.repository.name}&blueprint_name=sample`)
    ).json()) as SessionHistoryDetail[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: response.conversation_id, title: 'Prove it', status: 'running', first_message: 'Prove it', last_message: 'All done' });
    expect((await (await world.request(`/history?repository_owner=${world.repository.owner}&repository_name=${world.repository.name}&blueprint_name=other`)).json())).toEqual([]);

    const recent = (await (await world.request('/history/recent?limit=5')).json()) as Array<Record<string, unknown>>;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ id: response.conversation_id, repository_owner: world.repository.owner, repository_name: world.repository.name });

    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.messages.filter((row) => row.role === 'tool').map((row) => JSON.parse(row.content).kind)).toEqual([
      'tool_call',
      'agent_status',
      'agent_status',
      'tool_result',
    ]);
    expect(detail.subagents).toHaveLength(1);
    expect(detail.subagents[0]).toMatchObject({ parent_tool_use_id: 'task_1', tool_call_count: 1 });
    expect(detail.subagents[0].recent_tool_calls).toEqual([expect.objectContaining({ tool_use_id: 'sub_1', tool: 'Read', input: { file_path: 'Sample/Basic.lean' } })]);
    expect(typeof detail.subagents[0].started_at).toBe('string');
    expect(typeof detail.subagents[0].ended_at).toBe('string');

    const timeline = await (await world.request(`/history/${response.conversation_id}/subagents/task_1`)).json();
    expect((timeline as { messages: Array<{ content: string }> }).messages.map((row) => JSON.parse(row.content).kind)).toEqual(['tool_call', 'tool_result', 'subagent_text']);

    expect((await world.request('/history/missing')).status).toBe(404);
    expect((await world.request(`/history/${response.conversation_id}/share`, { method: 'POST' })).status).toBe(404);

    const reviewed = (await (await world.request(`/history/${response.conversation_id}/review-background`, { method: 'POST' })).json()) as SessionHistoryDetail;
    expect(reviewed.tier).toBe('completed');
    expect(reviewed.subagent_history_lazy).toBe(false);

    const deleted = await world.request(`/history/${response.conversation_id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    await waitFor(() => thread.closed);
    expect((await world.request(`/history/${response.conversation_id}`)).status).toBe(404);
    expect(world.ctx.registry.getConversation(response.conversation_id)).toBeNull();
    expect((await (await world.request('/active')).json())).toMatchObject({ active_count: 0 });
  });
});

describe('GET /sessions/:id/events', () => {
  async function readFrames(res: Response, count: number): Promise<string[]> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frames: string[] = [];
    while (frames.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      frames.push(...parts.filter(Boolean));
    }
    await reader.cancel();
    return frames;
  }

  it('replays after a cursor and prefixes a build snapshot while dropping replayed build steps', async () => {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    world = makeWorld({ lean: true });
    const room = () => world.ctx.blueprintRooms.get(`${world.repository.owner}/${world.repository.name}/sample`);
    const { response, thread } = await createSession(world);
    thread.toolCall('toolu_1', 'Edit', { file_path: 'Sample/Basic.lean', old_string: 'sorry', new_string: 'trivial' });
    thread.toolResult('toolu_1');
    thread.toolCall('build_1', 'mcp__fuse__lean_build', {});
    room().publish('build_status', { phase: 'building', message: 'Building Lean project...' });
    thread.toolResult('build_1');
    thread.complete();
    await flushAsync();
    // A build started elsewhere (the Lean routes, another session) is not this session's story.
    room().publish('build_status', { phase: 'building', message: 'Someone else is building' });
    expect(world.frames(response.session_id).some((frame) => frame.event === 'build_status' && (frame.data as { message: string }).message === 'Someone else is building')).toBe(false);
    const controller = new AbortController();
    const res = await world.request(`/${response.session_id}/events?last_event_id=1`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const received = await readFrames(res, 3);
    controller.abort();
    expect(received[0]).toContain('event: build_snapshot');
    expect(received[0]).not.toContain('id:');
    expect(received[1]).toContain('event: session_status');
    expect(received[1]).toContain('id: 2');
    expect(received[2]).toContain('event: turn_status');
    expect(received.some((frame) => frame.includes('event: build_status'))).toBe(false);
    expect((await world.request('/nope/events')).status).toBe(404);
    expect((await world.request(`/${response.session_id}/keepalive`, { method: 'POST' })).status).toBe(204);
    expect((await world.request(`/${response.session_id}/api-key-fallback`, { method: 'POST', body: { approved: true } })).status).toBe(409);
    const waited = await (await world.request(`/${response.session_id}/wait`, { method: 'POST', body: { timeout_seconds: 1 } })).json();
    expect(waited).toMatchObject({ session_id: response.session_id, status: 'running' });
    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.messages.filter((row) => row.role === 'tool').map((row) => JSON.parse(row.content).kind)).toEqual(['tool_call', 'tool_result', 'tool_call', 'tool_result']);
    expect(world.startBuild).not.toHaveBeenCalled();
  });
});

describe('post-turn hooks', () => {
  it('does not build on chat start or after Lean writes, even with a legacy flag', async () => {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    world = makeWorld({ autoCommit: true, lean: true });
    commitChanges.mockResolvedValue({ status: 'committed', commit_sha: 'abc', message: null });
    const { thread } = await createSession(world, 'Prove lemma A\nwith details');
    expect(world.startBuild).not.toHaveBeenCalled();
    thread.toolCall('toolu_1', 'Edit', { file_path: 'Sample/Basic.lean', old_string: 'sorry', new_string: 'trivial' });
    thread.toolResult('toolu_1');
    thread.complete();
    await flushAsync();
    expect(commitChanges).not.toHaveBeenCalled();
    expect(world.startBuild).not.toHaveBeenCalled();

  });
});

describe('timeouts and shutdown', () => {
  async function replaceWorld(options: Parameters<typeof makeWorld>[0]): Promise<void> {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    world = makeWorld(options);
  }

  it('ends an idle session as completed after the idle timeout', async () => {
    await replaceWorld({ idleTimeoutMs: 60 });
    const { response, thread } = await createSession(world);
    thread.text('done');
    thread.complete();
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    expect(world.frames(response.session_id).pop()).toMatchObject({ event: 'session_end', data: { status: 'completed' } });
    expect(world.ctx.registry.getConversation(response.conversation_id)).toMatchObject({ status: 'completed', tier: 'waiting_for_review' });
  });

  it('interrupts a silent turn, retries once with the recovery prompt, then fails the session', async () => {
    await replaceWorld({ activityTimeoutMs: 40 });
    const { response, thread } = await createSession(world);
    await waitFor(() => thread.interrupts === 1);
    thread.interrupted();
    await waitFor(() => thread.sends.length === 2);
    expect(thread.sends[1].text).toContain('reason: previous autonomous turn was interrupted after producing no SDK output');
    expect(world.frames(response.session_id).some((frame) => frame.event === 'agent_status' && (frame.data as { status: string }).status === 'recovering')).toBe(true);
    await waitFor(() => thread.interrupts === 2);
    thread.interrupted();
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    expect(world.frames(response.session_id).slice(-2).map((frame) => frame.event)).toEqual(['error', 'session_end']);
    expect(world.frames(response.session_id).pop()?.data).toEqual({ status: 'failed' });
  });

  it('shuts down live sessions as completed and refuses new ones', async () => {
    const { response, thread } = await createSession(world);
    const shutdown = world.service.shutdown();
    await waitFor(() => thread.interrupts === 1);
    thread.interrupted();
    await shutdown;
    expect(world.frames(response.session_id).pop()).toMatchObject({ event: 'session_end', data: { status: 'completed' } });
    expect(thread.closed).toBe(true);
    const res = await world.request('', {
      method: 'POST',
      body: { repository_owner: world.repository.owner, repository_name: world.repository.name, blueprint_name: 'sample', initial_message: 'x' },
    });
    expect(res.status).toBe(503);
  });

  it('never launches a turn for a session stopped before the runner started', async () => {
    const res = await world.request('', {
      method: 'POST',
      body: { repository_owner: world.repository.owner, repository_name: world.repository.name, blueprint_name: 'sample', initial_message: 'x' },
    });
    const response = (await res.json()) as SessionResponse;
    await world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await flushAsync();
    expect(world.threads).toHaveLength(0);
    expect(world.ctx.registry.getConversation(response.conversation_id)?.status).toBe('cancelled');
  });
});

describe('resuming a conversation', () => {
  it('resumes the provider thread by id when its state still exists and reports the new session\'s own replay cursor', async () => {
    const { response, thread } = await createSession(world);
    thread.start('provider-1');
    thread.text('One');
    thread.text('Two', 'block-b');
    thread.complete();
    await flushAsync();
    const before = (await (await world.request(`/history/${response.conversation_id}/live`)).json()) as ConversationLiveSession;
    expect(before.last_persisted_event_id).toBeGreaterThan(5);
    await world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));

    const resumed = await createSession(world, 'go on', { resume_from_conversation_id: response.conversation_id });
    expect(resumed.thread.launch.providerThreadId).toBe('provider-1');
    expect(resumed.thread.sends[0].text).not.toContain('continuation of an earlier chat session');
    resumed.thread.start('provider-1');
    resumed.thread.text('Three');
    // The new room's ids restart at 1: the cursor reported for this session
    // (and the history detail) must be this session's, not the old run's.
    const live = (await (await world.request(`/history/${response.conversation_id}/live`)).json()) as ConversationLiveSession;
    const chatFrame = world.frames(resumed.response.session_id).find((frame) => frame.event === 'chat' && (frame.data as { content: string }).content === 'Three');
    expect(live.last_persisted_event_id).toBe(chatFrame?.id);
    expect(live.last_persisted_event_id).toBeLessThan(before.last_persisted_event_id);
    const detail = (await (await world.request(`/history/${response.conversation_id}`)).json()) as SessionHistoryDetail;
    expect(detail.last_persisted_event_id).toBe(chatFrame?.id);
    // Subscribing from that cursor replays everything after the persisted chat row.
    resumed.thread.complete();
    await flushAsync();
    const replay = world.ctx.sessionRooms.peek(resumed.response.session_id)?.replayAfter(live.last_persisted_event_id) ?? [];
    expect(replay.map((frame) => frame.event)).toEqual(['session_result', 'turn_status']);
  });

  it('replays the transcript instead when the provider state is gone', async () => {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    const stateExists = vi.fn(() => false);
    world = makeWorld({ providerStateExists: stateExists });
    const { response, thread } = await createSession(world);
    thread.start('provider-gone');
    thread.text('First answer');
    thread.complete();
    await flushAsync();
    await world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    expect(world.ctx.registry.getConversation(response.conversation_id)?.provider_thread_id).toBe('provider-gone');

    const resumed = await createSession(world, 'go on', { resume_from_conversation_id: response.conversation_id });
    expect(stateExists).toHaveBeenCalledWith('claude', 'provider-gone');
    expect(resumed.thread.launch.providerThreadId).toBeNull();
    const prompt = resumed.thread.sends[0].text;
    expect(prompt).toContain('continuation of an earlier chat session');
    expect(prompt).toContain('User: Prove it\nAgent: First answer');
    expect(world.ctx.registry.getConversation(response.conversation_id)?.provider_thread_id).toBeNull();
    resumed.thread.start('provider-new');
    expect(world.ctx.registry.getConversation(response.conversation_id)?.provider_thread_id).toBe('provider-new');
  });

  it('retries once without the thread id when the CLI reports the thread gone, without surfacing an error', async () => {
    const { response, thread } = await createSession(world);
    thread.start('provider-1');
    thread.text('First answer');
    thread.complete();
    await flushAsync();
    await world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));

    const resumed = await createSession(world, 'go on', { resume_from_conversation_id: response.conversation_id });
    const stale = resumed.thread;
    expect(stale.launch.providerThreadId).toBe('provider-1');
    stale.fail('No conversation found with session ID: provider-1');
    await flushAsync();
    const fresh = world.threads[world.threads.length - 1];
    expect(fresh).not.toBe(stale);
    expect(stale.closed).toBe(true);
    expect(fresh.launch.providerThreadId).toBeNull();
    expect(fresh.sends[0].text).toContain('continuation of an earlier chat session');
    expect(fresh.sends[0].text.endsWith('User message: go on')).toBe(true);
    expect(world.frames(resumed.response.session_id).some((frame) => frame.event === 'error' || frame.event === 'session_end')).toBe(false);
    fresh.start('provider-2');
    fresh.text('Continuing');
    fresh.complete();
    await flushAsync();
    const live = (await (await world.request(`/history/${response.conversation_id}/live`)).json()) as ConversationLiveSession;
    expect(live).toMatchObject({ session_id: resumed.response.session_id, status: 'running', turn_active: false });
    expect(world.ctx.registry.getConversation(response.conversation_id)?.provider_thread_id).toBe('provider-2');
    // Only once: a second such failure is a real failure.
    await world.request(`/${resumed.response.session_id}/messages`, { method: 'POST', body: { content: 'more' } });
    await flushAsync();
    fresh.fail('No conversation found with session ID: provider-2');
    await waitFor(() => world.frames(resumed.response.session_id).some((frame) => frame.event === 'session_end'));
    expect(world.frames(resumed.response.session_id).pop()).toMatchObject({ event: 'session_end', data: { status: 'failed' } });
  });

  it('starts a fresh thread with the transcript replayed when the workspace switched provider', async () => {
    const { response, thread } = await createSession(world);
    thread.start('codex-thread-abc');
    thread.text('First answer');
    thread.complete();
    await flushAsync();
    await world.request(`/${response.session_id}/cancel`, { method: 'POST' });
    await waitFor(() => world.frames(response.session_id).some((frame) => frame.event === 'session_end'));
    expect(world.ctx.registry.getConversation(response.conversation_id)?.provider).toBe('claude');
    world.ctx.registry.updateBlueprint(world.repository.id, 'sample', { agent: { ...DEFAULT_AGENT_CONFIG, provider: 'codex' } });

    const resumed = await createSession(world, 'go on', { resume_from_conversation_id: response.conversation_id });
    expect(resumed.thread.launch.config.provider).toBe('codex');
    expect(resumed.thread.launch.providerThreadId).toBeNull();
    expect(resumed.thread.sends[0].text).toContain('User: Prove it\nAgent: First answer');
    expect(world.ctx.registry.getConversation(response.conversation_id)).toMatchObject({ provider: 'codex', provider_thread_id: null });
  });
});

describe('permissions and activity', () => {
  it('answers a late or duplicate permission response with 409', async () => {
    const { response, thread } = await createSession(world);
    thread.push({ kind: 'permission_request', turnId: thread.turnId, requestId: 'req-1', toolCallId: 'toolu_1', tool: 'Bash', input: { command: 'x' }, description: null, reason: null, suggestions: [], at: Date.now() });
    expect((await world.request(`/${response.session_id}/permissions/req-1`, { method: 'POST', body: { behavior: 'allow' } })).status).toBe(200);
    const duplicate = await world.request(`/${response.session_id}/permissions/req-1`, { method: 'POST', body: { behavior: 'deny' } });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ detail: 'This permission request is no longer pending.' });
    expect((await world.request(`/${response.session_id}/permissions/nope`, { method: 'POST', body: { behavior: 'allow' } })).status).toBe(409);
    expect(thread.permissionResponses).toHaveLength(1);
  });

  it('does not count the wait for a permission answer as provider silence', async () => {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    world = makeWorld({ activityTimeoutMs: 40 });
    const { response, thread } = await createSession(world);
    thread.push({ kind: 'permission_request', turnId: thread.turnId, requestId: 'req-1', toolCallId: 'toolu_1', tool: 'Bash', input: { command: 'x' }, description: null, reason: null, suggestions: [], at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(thread.interrupts).toBe(0);
    expect(((await (await world.request(`/history/${response.conversation_id}/live`)).json()) as ConversationLiveSession).status).toBe('running');
    await world.request(`/${response.session_id}/permissions/req-1`, { method: 'POST', body: { behavior: 'deny' } });
    // With the prompt answered the clock runs again.
    await waitFor(() => thread.interrupts === 1);
  });
});

describe('durability', () => {
  it('closes conversations left running by a previous process at startup', async () => {
    const { response, thread } = await createSession(world);
    thread.text('Working');
    thread.toolCall('toolu_1', 'Read', {});
    const queued = (await (await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'also this' } })).json()) as { message_id: string };
    await flushAsync();
    // The process dies without a shutdown: rows stay `running` / `queued` on disk.
    world.service.store.flushSync();
    world.ctx.registry.flushSync();
    const [dataDir, repoDir] = world.dirs;
    const restarted = makeWorld({ dataDir, repoDir });
    try {
      const row = restarted.ctx.registry.getConversation(response.conversation_id);
      expect(row).toMatchObject({ status: 'failed', tier: 'waiting_for_review' });
      expect(row?.completed_at).not.toBeNull();
      expect(restarted.service.activeSessionsForRepository(restarted.repository.id)[0]?.tier).toBe('waiting_for_review');
      const detail = await restarted.service.historyDetail(response.conversation_id);
      expect(detail.status).toBe('failed');
      expect(detail.messages.find((message) => message.id === queued.message_id)?.delivery_state).toBe('superseded');
    } finally {
      await restarted.service.shutdown();
    }
  });

  it('writes the completed status synchronously when shutdown starts', async () => {
    const { response, thread } = await createSession(world);
    thread.text('Working');
    const queued = (await (await world.request(`/${response.session_id}/messages`, { method: 'POST', body: { content: 'later' } })).json()) as { message_id: string };
    await flushAsync();
    const shutdown = world.service.shutdown();
    // Before any await settles, a fresh registry already reads the outcome.
    const [dataDir] = world.dirs;
    const fresh = new Registry(appPaths(dataDir));
    expect(fresh.getConversation(response.conversation_id)).toMatchObject({ status: 'completed', tier: 'waiting_for_review' });
    const stored = JSON.parse(readFileSync(appPaths(dataDir).conversationFile(response.conversation_id), 'utf8')) as { messages: Array<{ id: string; delivery_state: string | null }> };
    expect(stored.messages.find((message) => message.id === queued.message_id)?.delivery_state).toBe('superseded');
    thread.interrupted();
    await shutdown;
  });
});

describe('legacy autocommit settings', () => {
  it('does not commit a nested blueprint after a turn', async () => {
    await world.service.shutdown();
    await (world.ctx.services.shutdown as (() => Promise<void>) | undefined)?.();
    for (const dir of world.dirs) rmSync(dir, { recursive: true, force: true });
    world = makeWorld({ autoCommit: true, blueprint: { project_subdir: 'lean', blueprint_file: 'blueprint/src/content.tex' } });
    commitChanges.mockResolvedValue({ status: 'committed', commit_sha: 'abc', message: null });
    const { thread, response } = await createSession(world, 'Write the chapter');
    thread.toolCall('toolu_1', 'Edit', { file_path: 'blueprint/src/content.tex', old_string: 'a', new_string: 'b' });
    thread.toolResult('toolu_1');
    thread.complete();
    await waitFor(() => world.attention.mock.calls.some(([id, event]) => id === response.conversation_id && event.kind === 'turn_completed'));
    expect(commitChanges).not.toHaveBeenCalled();
  });
});
