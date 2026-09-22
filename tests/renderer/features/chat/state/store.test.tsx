import { createChatStore } from '@/features/chat/state/store';
import type { PersistedChatMessage, SubagentStream } from '@/features/chat/state/types';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  sendSessionMessage: vi.fn(),
  cancelSession: vi.fn(),
  respondPermissionRequest: vi.fn(),
  fetchSessionState: vi.fn(),
  fetchLiveSessionForConversation: vi.fn(),
  fetchSessionHistoryDetail: vi.fn(),
  fetchSubagentHistory: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    createSession: mocks.createSession,
    sendSessionMessage: mocks.sendSessionMessage,
    cancelSession: mocks.cancelSession,
    respondPermissionRequest: mocks.respondPermissionRequest,
    fetchSessionState: mocks.fetchSessionState,
    fetchLiveSessionForConversation: mocks.fetchLiveSessionForConversation,
    fetchSessionHistoryDetail: mocks.fetchSessionHistoryDetail,
    fetchSubagentHistory: mocks.fetchSubagentHistory,
  };
});

function createStore() {
  return createChatStore({
    repositoryOwner: 'numina',
    repositoryName: 'fuse',
    blueprintName: 'example',
  });
}

let eventListeners = new Map<string, (event: Event) => void>();
let latestEventSource: { readyState: number } | null = null;

function trackEventSource(source: { readyState: number }): void {
  latestEventSource = source;
}

/** Dispatches an SSE frame through the store's registered internal listener. */
function emitSse(
  eventName: string,
  data: Record<string, unknown>,
  eventId?: string,
): void {
  eventListeners.get(eventName)?.(
    new MessageEvent(eventName, {
      data: JSON.stringify(data),
      ...(eventId ? { lastEventId: eventId } : {}),
    }),
  );
}

const RUNNING_SESSION = {
  session_id: 'session-1',
  conversation_id: 'conversation-1',
  agent_job_id: 'job-1',
  status: 'running',
  is_active_session: true,
  can_send: false,
  can_cancel: true,
  build_status: 'done',
  display_status: 'Running autonomously.',
  turn_active: true,
  active_prover_batch_id: null,
  active_prover_batch_total: 0,
  active_prover_batch_completed: 0,
};

function persistedRunningStart() {
  return {
    id: 'conversation-1',
    status: 'running',
    blueprint_name: 'example',
    created_at: '2026-08-26T12:00:00Z',
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    total_cost_usd: null,
    message_count: 1,
    first_message: 'Start',
    last_message: 'Start',
    last_persisted_event_id: 1,
    messages: [{
      id: 'start-message',
      role: 'user',
      content: 'Start',
      created_at: '2026-08-26T12:00:00Z',
    }],
  };
}

beforeEach(() => {
  mocks.createSession.mockReset();
  mocks.sendSessionMessage.mockReset();
  mocks.cancelSession.mockReset();
  mocks.respondPermissionRequest.mockReset();
  mocks.fetchSessionState.mockReset();
  mocks.fetchLiveSessionForConversation.mockReset();
  mocks.fetchSessionHistoryDetail.mockReset();
  mocks.fetchSubagentHistory.mockReset();
  mocks.sendSessionMessage.mockResolvedValue({ status: 'accepted' });
  mocks.cancelSession.mockResolvedValue({
    status: 'stop_requested',
    message_delivery_states: {},
  });
  mocks.respondPermissionRequest.mockResolvedValue({ status: 'accepted' });
  eventListeners = new Map();
  vi.stubGlobal('EventSource', class EventSourceMock {
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readyState = 0;
    onopen = null;
    onerror = null;
    addEventListener = vi.fn((
      eventName: string,
      handler: (event: Event) => void,
    ) => {
      eventListeners.set(eventName, handler);
    });
    close = vi.fn();
    constructor() {
      trackEventSource(this);
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat run controls', () => {
  it('clears the running control when preparing a new chat', async () => {
    const store = createStore();

    await store.prepareNewAgentSession();

    expect(store.getSnapshot().autonomousRunActive).toBe(false);
  });

  it('detaches from an autonomous session without cancelling it', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Continue the formalization');

    await store.prepareNewAgentSession();

    expect(mocks.cancelSession).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      messages: [],
      conversationId: null,
      sessionId: null,
      sending: false,
    });
  });

  it('activates autonomous controls while the session request is pending', async () => {
    let rejectRequest: (error: Error) => void = () => undefined;
    mocks.createSession.mockReturnValue(new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }));
    const store = createStore();

    const sendPromise = store.send('Continue the formalization');

    expect(store.getSnapshot()).toMatchObject({
      autonomousRunActive: true,
      sending: true,
    });

    rejectRequest(new Error('request failed'));
    await sendPromise;
    expect(store.getSnapshot().autonomousRunActive).toBe(false);
  });

  it('keeps autonomous controls active between creation and turn status', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'not_started',
      display_status: 'Starting agent...',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();

    await store.send('Continue the formalization');

    expect(store.getSnapshot()).toMatchObject({
      autonomousRunActive: true,
      sending: true,
    });
    store.disconnect();
  });

  it('queues steering while the current turn is still sending', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Autonomous run in progress.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');

    expect(store.getSnapshot().sending).toBe(true);
    await expect(store.send('Steer the active turn')).resolves.toBe(true);
    expect(mocks.sendSessionMessage).toHaveBeenCalledWith('session-1', {
      content: 'Steer the active turn',
    });
    expect(store.getSnapshot()).toMatchObject({
      autonomousRunActive: true,
    });
    store.disconnect();
  });

  it('keeps the active callback and ignores a new callback factory for steering', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    const followTurn = vi.fn();
    await store.send('Start', () => followTurn);
    followTurn.mockClear();
    const createSteeringScroll = vi.fn(() => vi.fn());

    await store.send('Steer without moving the transcript', createSteeringScroll);
    emitSse('tool_call', {
      tool: 'Read',
      tool_use_id: 'read-1',
      input: { file_path: 'Main.lean' },
    });

    expect(createSteeringScroll).not.toHaveBeenCalled();
    expect(followTurn).toHaveBeenCalled();
    store.disconnect();
  });

  it('opens an idle follow-up as an optimistic turn instead of steering', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');
    emitSse('turn_status', { turn_active: false });

    let finishSend: (response: {
      status: string;
      message_id: string;
      delivery_state: string;
    }) => void = () => undefined;
    mocks.sendSessionMessage.mockReturnValueOnce(new Promise((resolve) => {
      finishSend = resolve;
    }));

    const followUp = store.send('Next question');
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      text: 'Next question',
      deliveryState: 'queued',
      optimisticTurn: true,
    });

    finishSend({
      status: 'accepted',
      message_id: 'next-message',
      delivery_state: 'queued',
    });
    await followUp;
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      messageId: 'next-message',
      deliveryState: 'queued',
      optimisticTurn: true,
    });

    emitSse('chat', {
      role: 'agent',
      content: 'Next answer',
      assistant_turn_id: 'next-answer',
    });
    emitSse('message_delivery', {
      message_id: 'next-message',
      state: 'delivered',
    });
    const deliveredMessage = store.getSnapshot().messages.find(
      (message) => message.messageId === 'next-message',
    );
    expect(deliveredMessage).toMatchObject({
      messageId: 'next-message',
      deliveryState: 'delivered',
    });
    expect(deliveredMessage?.optimisticTurn).toBeUndefined();
    expect(store.getSnapshot().messages.map((message) => message.text)).toEqual([
      'Start',
      'Next question',
      'Next answer',
    ]);
    store.disconnect();
  });

  it('keeps optimistic turn ids stable through live history reconciliation', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    mocks.sendSessionMessage.mockResolvedValueOnce({
      status: 'accepted',
      message_id: 'next-message',
      delivery_state: 'queued',
    });
    const store = createStore();
    await store.send('Start');
    emitSse('chat', {
      role: 'agent',
      content: 'First answer',
      assistant_turn_id: 'turn-0:assistant-0',
    });
    emitSse('turn_status', { turn_active: false });
    await store.send('Next question');

    mocks.fetchLiveSessionForConversation.mockResolvedValue({
      ...RUNNING_SESSION,
      execution_mode: 'background',
      event_counter: 20,
      last_persisted_event_id: 10,
    });
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      id: 'conversation-1',
      status: 'running',
      blueprint_name: 'example',
      created_at: '2026-08-26T12:00:00Z',
      completed_at: null,
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      message_count: 5,
      first_message: 'Start',
      last_message: 'Persisted next answer',
      last_persisted_event_id: 10,
      messages: [
        {
          id: 'start-message',
          role: 'user',
          content: 'Start',
          created_at: '2026-08-26T12:00:00Z',
        },
        {
          id: 'first-answer',
          role: 'agent',
          content: 'First answer',
          created_at: '2026-08-26T12:00:01Z',
        },
        {
          id: 'next-message',
          role: 'user',
          content: 'Next question',
          delivery_state: 'queued',
          created_at: '2026-08-26T12:00:02Z',
        },
        {
          id: 'next-tool',
          role: 'tool',
          content: JSON.stringify({
            kind: 'tool_call',
            tool: 'Read',
            tool_use_id: 'next-read',
            input: { file_path: 'Main.lean' },
          }),
          created_at: '2026-08-26T12:00:03Z',
        },
        {
          id: 'next-answer',
          role: 'agent',
          content: 'Persisted next answer',
          created_at: '2026-08-26T12:00:04Z',
        },
      ],
    });

    await store.loadHistory('conversation-1');
    emitSse('stream_start', {
      assistant_turn_id: 'turn-2:assistant-0',
    });
    emitSse('chat', {
      role: 'agent',
      content: 'Persisted next answer',
      assistant_turn_id: 'turn-2:assistant-0',
    });

    expect(store.getSnapshot().messages.filter(
      (message) => message.text === 'Persisted next answer',
    )).toHaveLength(1);
    expect(store.getSnapshot().messages.find(
      (message) => message.text === 'Persisted next answer',
    )?.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolUseId: 'next-read',
        anchorTurnId: 'turn-2',
      }),
    ]));
    store.disconnect();
  });

  it('keeps queued activity on the running turn and adopts identities FIFO', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');

    await store.send('Same steering note');
    await store.send('Same steering note');
    emitSse('tool_call', {
      tool: 'Read',
      tool_use_id: 'read-before-identity',
      input: { file_path: 'Main.lean' },
    });
    expect(store.getSnapshot().activities[0]).toMatchObject({
      anchorTurnId: 'turn-0',
      anchorAfterMessageCount: 0,
    });

    // The runner publishes this before the chat event that identifies the
    // optimistic row. The terminal state must survive that event's stale
    // `queued` payload.
    emitSse('message_delivery', { message_id: 'message-1', state: 'steered' });
    emitSse('chat', {
      role: 'user',
      content: 'Same steering note',
      message_id: 'message-1',
      delivery_state: 'queued',
    });
    emitSse('chat', {
      role: 'user',
      content: 'Same steering note',
      message_id: 'message-2',
      delivery_state: 'queued',
    });

    const steeringMessages = store.getSnapshot().messages.slice(1);
    expect(steeringMessages.find(
      (message) => message.messageId === 'message-1',
    )?.deliveryState).toBe('steered');
    expect(steeringMessages.find(
      (message) => message.messageId === 'message-2',
    )?.deliveryState).toBe('queued');

    emitSse('tool_call', {
      tool: 'Grep',
      tool_use_id: 'grep-after-steer',
      input: { pattern: 'theorem' },
    });
    expect(store.getSnapshot().activities[1]).toMatchObject({
      anchorTurnId: 'turn-1',
      anchorAfterMessageCount: 0,
    });
    store.disconnect();
  });

  it('does not attach a follow-up identity to older identical transcript text', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    mocks.sendSessionMessage.mockResolvedValueOnce({
      status: 'accepted',
      message_id: 'follow-up-message',
      delivery_state: 'delivered',
    });
    const store = createStore();
    await store.send('Same message');

    await store.send('Same message');

    const [initialMessage, followUpMessage] = store.getSnapshot().messages;
    expect(initialMessage).toEqual({ role: 'user', text: 'Same message' });
    expect(followUpMessage).toEqual(expect.objectContaining({
      text: 'Same message',
      messageId: 'follow-up-message',
      deliveryState: 'delivered',
    }));
    store.disconnect();
  });

  it('does not regress an SSE delivery update when the send response arrives', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');
    mocks.sendSessionMessage.mockImplementationOnce(async () => {
      emitSse('chat', {
        role: 'user',
        content: 'Steer this',
        message_id: 'steered-message',
        delivery_state: 'queued',
      });
      emitSse('message_delivery', {
        message_id: 'steered-message',
        state: 'steered',
      });
      return {
        status: 'accepted',
        message_id: 'steered-message',
        delivery_state: 'queued',
      };
    });

    await store.send('Steer this');

    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      messageId: 'steered-message',
      deliveryState: 'steered',
    });
    store.disconnect();
  });

  it('places a delivered queued message after the answer it waited behind', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('First question');
    await store.send('Second question');
    emitSse('chat', {
      role: 'user',
      content: 'Second question',
      message_id: 'second-message',
      delivery_state: 'queued',
    });
    emitSse('chat', {
      role: 'agent',
      content: 'First answer',
      assistant_turn_id: 'first-answer',
    });

    emitSse('message_delivery', {
      message_id: 'second-message',
      state: 'delivered',
    });

    expect(store.getSnapshot().messages.map((message) => message.text)).toEqual([
      'First question',
      'First answer',
      'Second question',
    ]);
    store.disconnect();
  });

  it('rejects failed steering without losing the active-turn state', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');
    mocks.sendSessionMessage.mockRejectedValueOnce(new Error('queue rejected'));

    await expect(store.send('Do not lose this')).resolves.toBe(false);
    expect(store.getSnapshot().sending).toBe(true);
    expect(store.getSnapshot().messages.filter(
      (message) => message.role === 'user',
    ).map((message) => message.text)).toEqual(['Start']);
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      isError: true,
      text: 'Failed to send: queue rejected',
    });
    store.disconnect();
  });

  it('does not roll back newer SSE state when steering fails', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');
    eventListeners.get('turn_status')?.(
      new MessageEvent('turn_status', {
        data: JSON.stringify({ turn_active: false }),
      }),
    );
    expect(store.getSnapshot().sending).toBe(false);

    let rejectSteering: (error: Error) => void = () => undefined;
    mocks.sendSessionMessage.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSteering = reject;
      }),
    );
    const steering = store.send('Steer the next turn');
    eventListeners.get('turn_status')?.(
      new MessageEvent('turn_status', {
        data: JSON.stringify({ turn_active: true }),
      }),
    );
    rejectSteering(new Error('queue rejected'));

    await expect(steering).resolves.toBe(false);
    expect(store.getSnapshot().sending).toBe(true);
    expect(store.getSnapshot().liveSession.turnActive).toBe(true);
    expect(store.getSnapshot().liveSession.canSend).toBe(false);
    store.disconnect();
  });

  it('recovers when a dead-session replacement request also fails', async () => {
    mocks.createSession.mockResolvedValueOnce({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');
    mocks.sendSessionMessage.mockRejectedValueOnce(
      new ApiError('session missing', 404),
    );
    mocks.createSession.mockRejectedValueOnce(new Error('restart failed'));

    await expect(store.send('Resume me')).resolves.toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      sessionId: null,
      sending: false,
      autonomousRunActive: false,
    });

    mocks.createSession.mockResolvedValueOnce({
      session_id: 'session-2',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-2',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    await expect(store.send('Try again')).resolves.toBe(true);
    expect(store.getSnapshot().sessionId).toBe('session-2');
    store.disconnect();
  });

  it('unlatches an idle session when steering fails', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');
    eventListeners.get('turn_status')?.(
      new MessageEvent('turn_status', {
        data: JSON.stringify({ turn_active: false }),
      }),
    );
    mocks.sendSessionMessage.mockRejectedValueOnce(new Error('gateway failed'));

    await expect(store.send('Steer')).resolves.toBe(false);
    expect(store.getSnapshot().sending).toBe(false);
    expect(store.getSnapshot().liveSession.canSend).toBe(true);
    store.disconnect();
  });

  it('keeps a newly selected effort through closed-stream reconciliation', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: true,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: false,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');
    if (latestEventSource) latestEventSource.readyState = EventSource.CLOSED;
    mocks.fetchSessionState.mockResolvedValue({
      session_id: 'session-1',
      status: 'running',
      event_counter: 4,
      turn_active: false,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
      active_work_group_count: 0,
      is_active_session: true,
      can_send: true,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
    });

    await store.send('Use autonomous effort');

    expect(mocks.sendSessionMessage).toHaveBeenLastCalledWith('session-1', {
      content: 'Use autonomous effort',
    });
    store.disconnect();
  });

  it('does not create next-turn scrolling when reconciliation discovers active work', async () => {
    mocks.createSession.mockResolvedValue({
      ...RUNNING_SESSION,
      turn_active: false,
      can_send: true,
    });
    const store = createStore();
    await store.send('Start');
    emitSse('turn_status', { turn_active: false });
    if (latestEventSource) latestEventSource.readyState = EventSource.CLOSED;
    mocks.fetchLiveSessionForConversation.mockResolvedValue({
      ...RUNNING_SESSION,
      execution_mode: 'background',
      event_counter: 5,
      last_persisted_event_id: 1,
      turn_active: true,
      can_send: false,
      active_work_group_count: 0,
    });
    mocks.fetchSessionHistoryDetail.mockResolvedValue(persistedRunningStart());
    const createTurnScroll = vi.fn(() => vi.fn());

    await store.send('Steer after reconnect', createTurnScroll);

    expect(createTurnScroll).not.toHaveBeenCalled();
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      text: 'Steer after reconnect',
      deliveryState: 'queued',
    });
    expect(store.getSnapshot().messages.at(-1)?.optimisticTurn).toBeUndefined();
    expect(mocks.sendSessionMessage).toHaveBeenLastCalledWith('session-1', {
      content: 'Steer after reconnect',
    });
    store.disconnect();
  });

  it('creates next-turn scrolling when reconciliation discovers an idle session', async () => {
    mocks.createSession.mockResolvedValue({
      ...RUNNING_SESSION,
      turn_active: true,
      can_send: false,
    });
    const store = createStore();
    await store.send('Start');
    if (latestEventSource) latestEventSource.readyState = EventSource.CLOSED;
    mocks.fetchLiveSessionForConversation.mockResolvedValue({
      ...RUNNING_SESSION,
      execution_mode: 'background',
      event_counter: 5,
      last_persisted_event_id: 1,
      turn_active: false,
      can_send: true,
      active_work_group_count: 0,
    });
    mocks.fetchSessionHistoryDetail.mockResolvedValue(persistedRunningStart());
    const followTurn = vi.fn();
    const createTurnScroll = vi.fn(() => followTurn);

    await store.send('Continue after reconnect', createTurnScroll);

    expect(createTurnScroll).toHaveBeenCalledOnce();
    expect(followTurn).toHaveBeenCalled();
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      text: 'Continue after reconnect',
      deliveryState: 'queued',
      optimisticTurn: true,
    });
    expect(mocks.sendSessionMessage).toHaveBeenLastCalledWith('session-1', {
      content: 'Continue after reconnect',
      // The composer no longer offers a choice, so a follow-up turn carries
      // the only level ADR 049 leaves regardless of what the reconciled
      // session was originally written with.
    });
    store.disconnect();
  });

  it('dedupes replayed subagent events by stable ids without collapsing equal prose', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');

    const emitSubagentEvent = (
      eventName: string,
      eventId: string,
      data: Record<string, unknown>,
    ) => {
      eventListeners.get(eventName)?.(
        new MessageEvent(eventName, {
          data: JSON.stringify(data),
          lastEventId: eventId,
        }),
      );
    };
    emitSubagentEvent('subagent_message', '7', {
      parent_tool_use_id: 'child-1',
      text: 'Same words',
      message_id: 'message-1',
    });
    emitSubagentEvent('subagent_message', '8', {
      parent_tool_use_id: 'child-1',
      text: 'Same words',
      message_id: 'message-2',
    });
    emitSubagentEvent('subagent_message', '9', {
      parent_tool_use_id: 'child-1',
      text: 'Same words',
      message_id: 'message-1',
    });

    expect(store.getSnapshot().subagents[0].messages).toHaveLength(2);
    expect(store.getSnapshot().subagents[0].messages?.map(
      (message) => message.messageId,
    )).toEqual(['message-1', 'message-2']);

    // A reconnect replays the deltas for an already-applied final. The partial
    // must not survive as a third segment beside the confirmed copy.
    emitSubagentEvent('subagent_stream_delta', '10', {
      parent_tool_use_id: 'child-1',
      text: 'Same wo',
      delta_kind: 'text',
    });
    emitSubagentEvent('subagent_message', '11', {
      parent_tool_use_id: 'child-1',
      text: 'Same words',
      message_id: 'message-2',
    });
    expect(store.getSnapshot().subagents[0].messages).toHaveLength(2);
    expect(store.getSnapshot().subagents[0].messages?.some(
      (message) => message.streaming,
    )).toBe(false);
    expect(store.getSnapshot().subagents[0].text).toBe('Same words\n\nSame words');
    store.disconnect();
  });

  it('bounds subagent event replay memory to the recent SSE window', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Agent is working.',
      turn_active: true,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    const store = createStore();
    await store.send('Start');

    const emitDelta = (eventId: string, text: string) => {
      eventListeners.get('subagent_stream_delta')?.(
        new MessageEvent('subagent_stream_delta', {
          data: JSON.stringify({
            parent_tool_use_id: 'child-1',
            text,
          }),
          lastEventId: eventId,
        }),
      );
    };

    emitDelta('oldest', 'a');
    emitDelta('oldest', 'a');
    expect(store.getSnapshot().subagents[0].text).toBe('a');

    // The client keeps twice the backend replay buffer. Once that window has
    // moved on, an ancient id is evicted instead of living for the whole chat.
    for (let index = 0; index < 2_000; index += 1) {
      emitDelta(`recent-${index}`, '');
    }
    emitDelta('oldest', 'a');
    expect(store.getSnapshot().subagents[0].text).toBe('aa');
    store.disconnect();
  });

  it('shows delegated reconciliation while a stop request is pending', async () => {
    mocks.createSession.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
      turn_active: false,
      active_prover_batch_id: null,
      active_prover_batch_total: 0,
      active_prover_batch_completed: 0,
    });
    let finishStop: () => void = () => undefined;
    mocks.cancelSession.mockReturnValue(new Promise((resolve) => {
      finishStop = () => resolve({
        status: 'stop_requested',
        message_delivery_states: {},
      });
    }));
    const store = createStore();
    await store.send('Delegate the proof');
    eventListeners.get('work_group_status')?.(
      new MessageEvent('work_group_status', {
        data: JSON.stringify({
          status: 'running',
          task_count: 3,
          completed_count: 1,
          active_group_count: 1,
        }),
      }),
    );

    const stopping = store.stop();
    expect(store.getSnapshot().liveSession.displayStatus).toBe(
      'Stopping…',
    );
    finishStop();
    await stopping;
    store.disconnect();
  });

  it('retains an accepted queued message without running another turn', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    mocks.cancelSession.mockResolvedValue({
      status: 'stop_requested',
      message_delivery_states: { 'queued-message': 'retained' },
    });
    const store = createStore();
    await store.send('Start');
    await store.send('Answer this before stopping');
    emitSse('chat', {
      role: 'user',
      content: 'Answer this before stopping',
      message_id: 'queued-message',
      delivery_state: 'queued',
    });

    await store.stop();

    expect(store.getSnapshot().sessionId).toBeNull();
    expect(store.getSnapshot().liveSession).toMatchObject({
      canSend: true,
      canCancel: false,
      displayStatus: null,
    });
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      messageId: 'queued-message',
      deliveryState: 'retained',
    });
    store.disconnect();
  });

  it('uses backend delivery states instead of retaining every local queue row', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');
    await store.send('First follow-up');
    emitSse('chat', {
      role: 'user',
      content: 'First follow-up',
      message_id: 'message-1',
      delivery_state: 'queued',
    });
    await store.send('Second follow-up');
    emitSse('chat', {
      role: 'user',
      content: 'Second follow-up',
      message_id: 'message-2',
      delivery_state: 'queued',
    });
    mocks.cancelSession.mockResolvedValue({
      status: 'stop_requested',
      message_delivery_states: {
        'message-1': 'steered',
        'message-2': 'retained',
      },
    });

    await store.stop();

    expect(store.getSnapshot().messages.find(
      (message) => message.messageId === 'message-1',
    )?.deliveryState).toBe('steered');
    expect(store.getSnapshot().messages.find(
      (message) => message.messageId === 'message-2',
    )?.deliveryState).toBe('retained');
    store.disconnect();
  });

  it('cancels queued and running subagent cards after a successful stop', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Delegate the proof');
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'running-child',
      input: { description: 'Running child' },
    });
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'queued-child',
      input: { description: 'Queued child', status: 'queued' },
    });

    expect(store.getSnapshot().subagents.map((subagent) => subagent.status)).toEqual([
      'running',
      'queued',
    ]);

    await store.stop();

    expect(store.getSnapshot().subagents.map((subagent) => subagent.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
  });
});

describe('error event delivery', () => {
  function liveSession(conversationId: string) {
    const suffix = conversationId.at(-1) ?? '1';
    return {
      ...RUNNING_SESSION,
      session_id: `session-${suffix}`,
      conversation_id: conversationId,
      agent_job_id: `job-${suffix}`,
      execution_mode: 'foreground',
      event_counter: 10,
      last_persisted_event_id: 0,
    };
  }

  function historyDetail(
    conversationId: string,
    messages: PersistedChatMessage[] = [{
      id: `message-${conversationId}`,
      role: 'user',
      content: `Start ${conversationId}`,
      created_at: '2026-08-20T12:00:00Z',
    }],
  ) {
    return {
      id: conversationId,
      status: 'running' as const,
      blueprint_name: 'example',
      created_at: '2026-08-20T12:00:00Z',
      completed_at: null,
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      message_count: messages.length,
      first_message: messages[0]?.content ?? null,
      last_message: messages.at(-1)?.content ?? null,
      messages,
      last_persisted_event_id: 0,
    };
  }

  it('shows a replayed error event only once', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');

    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');

    expect(store.getSnapshot().messages.filter((message) => message.isError))
      .toEqual([expect.objectContaining({
        text: 'The agent stopped unexpectedly.',
      })]);
    store.disconnect();
  });

  it('keeps an id-less stream error that inherits the previous event ID', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');

    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');
    emitSse('error', { message: 'The event stream disconnected.' }, 'event-1');

    expect(store.getSnapshot().messages.filter((message) => message.isError)
      .map((message) => message.text)).toEqual([
      'The agent stopped unexpectedly.',
      'The event stream disconnected.',
    ]);
    store.disconnect();
  });

  it('keeps separate error events even when their messages match', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');

    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-2');

    expect(store.getSnapshot().messages.filter((message) => message.isError))
      .toHaveLength(2);
    store.disconnect();
  });

  it('still reconciles live state when an error replay is hidden', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Start');
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');
    emitSse('turn_status', { turn_active: false });
    await store.send('Try again');
    expect(store.getSnapshot().sending).toBe(true);

    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');

    expect(store.getSnapshot().sending).toBe(false);
    expect(store.getSnapshot().messages.filter((message) => message.isError))
      .toHaveLength(1);
    store.disconnect();
  });

  it('allows the same event identity in a different live session', async () => {
    mocks.fetchLiveSessionForConversation.mockImplementation(
      async (conversationId: string) => liveSession(conversationId),
    );
    mocks.fetchSessionHistoryDetail.mockImplementation(
      async (conversationId: string) => historyDetail(conversationId, [{
        id: `message-${conversationId}`,
        role: 'user',
        content: 'Same initial request',
        created_at: '2026-08-20T12:00:00Z',
      }]),
    );
    const store = createStore();
    await store.loadHistory('conversation-1');
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');

    await store.loadHistory('conversation-2');
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');

    expect(store.getSnapshot().messages.filter((message) => message.isError))
      .toHaveLength(2);
    expect(store.getSnapshot().conversationId).toBe('conversation-2');
    store.disconnect();
  });

  it('rebuilds error dedup state from rows retained after history refresh', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(
      liveSession('conversation-1'),
    );
    mocks.fetchSessionHistoryDetail
      .mockResolvedValueOnce(historyDetail('conversation-1'))
      .mockResolvedValueOnce(historyDetail('conversation-1', [
        {
          id: 'message-user',
          role: 'user' as const,
          content: 'Start conversation-1',
          created_at: '2026-08-20T12:00:00Z',
        },
        {
          id: 'message-agent',
          role: 'agent' as const,
          content: 'Recovered.',
          created_at: '2026-08-20T12:00:01Z',
        },
      ]));
    const store = createStore();
    await store.loadHistory('conversation-1');
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');

    await store.loadHistory('conversation-1');
    expect(store.getSnapshot().messages.some((message) => message.isError))
      .toBe(false);
    emitSse('error', { message: 'The agent stopped unexpectedly.' }, 'event-1');

    expect(store.getSnapshot().messages.filter((message) => message.isError))
      .toHaveLength(1);
    store.disconnect();
  });
});

describe('delegated subagent prose', () => {
  async function startDelegatedRun() {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Delegate the proof');
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'child-1',
      input: {
        description: 'Formalize Foo',
        synthetic_for: 'delegated-multistep',
      },
    });
    return store;
  }

  it('dates a live run from its spawn to its terminal status', async () => {
    const started = Date.now();
    const store = await startDelegatedRun();

    const [spawned] = store.getSnapshot().subagents;
    expect(spawned.startedAt).toBeGreaterThanOrEqual(started);
    expect(spawned.endedAt).toBeUndefined();

    emitSse('agent_status', {
      agent: 'Formalize Foo',
      status: 'completed',
      tool_use_id: 'child-1',
    });

    const [settled] = store.getSnapshot().subagents;
    expect(settled.status).toBe('done');
    expect(settled.endedAt).toBeGreaterThanOrEqual(settled.startedAt!);
    store.disconnect();
  });

  it('never lets a thinking delta reach the rendered transcript', async () => {
    const store = await startDelegatedRun();

    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'The user probably wants me to cheat here, but',
      delta_kind: 'thinking',
    }, '10');

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.messages ?? []).toHaveLength(0);
    expect(subagent.text).toBe('');
    store.disconnect();
  });

  it('streams a text delta live, token by token', async () => {
    const store = await startDelegatedRun();

    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Foo is proved ',
      delta_kind: 'text',
    }, '10');
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'by simp.',
      delta_kind: 'text',
    }, '11');

    const [subagent] = store.getSnapshot().subagents;
    // One growing live segment, rendered before the durable copy lands.
    expect(subagent.messages).toEqual([
      expect.objectContaining({ text: 'Foo is proved by simp.', streaming: true }),
    ]);
    expect(subagent.text).toBe('Foo is proved by simp.');
    store.disconnect();
  });

  it('treats an absent delta_kind as text', async () => {
    const store = await startDelegatedRun();

    // The compatibility path: `delta_kind` is NotRequired on the wire, and the
    // documented default when absent is 'text'. Only an emitter older than the
    // field can omit it, and it renders exactly as it did before the field.
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Legacy untagged prose.',
    }, '10');

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.messages?.map((message) => message.text)).toEqual([
      'Legacy untagged prose.',
    ]);
    expect(subagent.text).toBe('Legacy untagged prose.');
    store.disconnect();
  });

  it('drops an unrecognized delta kind rather than leaking it', async () => {
    const store = await startDelegatedRun();

    // Mirrors the bridge's fail-closed rule: unknown means "do not render".
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Some future block kind',
      delta_kind: 'redacted_thinking',
    }, '10');

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.messages ?? []).toHaveLength(0);
    expect(subagent.text).toBe('');
    store.disconnect();
  });

  it('leaves nothing behind when a step only produced a tool call', async () => {
    const store = await startDelegatedRun();

    // A tool-use-only assistant message — the normal shape of every
    // tool-calling step — is thinking plus tool_use and never emits
    // subagent_message, so the tool call is the only signal the message closed.
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Reasoning nobody should see',
      delta_kind: 'thinking',
    }, '10');
    emitSse('tool_call', {
      tool: 'Read',
      tool_use_id: 'read-1',
      parent_tool_use_id: 'child-1',
      input: { file_path: '/tmp/Foo.lean' },
    });

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.toolCalls).toHaveLength(1);
    expect(subagent.messages ?? []).toHaveLength(0);
    expect(subagent.text).toBe('');
    store.disconnect();
  });

  it('drops an unconfirmed segment left dangling by a tool call', async () => {
    const store = await startDelegatedRun();

    // Defence in depth for a backend too old to tag delta kinds: a completed
    // text block always publishes its durable copy before the tool_use block
    // that follows it, so anything still streaming at the tool call was never
    // confirmed and must not stand as prose.
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Untagged reasoning from an old emitter',
    }, '10');
    emitSse('tool_call', {
      tool: 'Read',
      tool_use_id: 'read-1',
      parent_tool_use_id: 'child-1',
      input: { file_path: '/tmp/Foo.lean' },
    });

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.messages ?? []).toHaveLength(0);
    expect(subagent.text).toBe('');
    store.disconnect();
  });

  it('replaces the live segment with the durable copy a child publishes', async () => {
    const store = await startDelegatedRun();

    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Foo is proved by si',
      delta_kind: 'text',
    }, '10');
    emitSse('subagent_message', {
      parent_tool_use_id: 'child-1',
      text: 'Foo is proved by simp.',
      message_id: 'message-1',
    }, '11');

    const [subagent] = store.getSnapshot().subagents;
    // Superseded in place: one segment, no longer streaming, not duplicated.
    expect(subagent.messages).toEqual([
      { text: 'Foo is proved by simp.', order: expect.any(Number), messageId: 'message-1' },
    ]);
    expect(subagent.text).toBe('Foo is proved by simp.');
    store.disconnect();
  });

  it('settles the live segment of a child cancelled mid-message', async () => {
    const store = await startDelegatedRun();

    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Partial prose cut off by a cancel',
      delta_kind: 'text',
    }, '10');
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: ' and some reasoning',
      delta_kind: 'thinking',
    }, '11');
    emitSse('agent_status', {
      agent: 'Formalize Foo',
      status: 'stopped',
      tool_use_id: 'child-1',
    });

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.status).toBe('cancelled');
    // The prose it managed to say is kept and settled; the reasoning never
    // entered the transcript, so nothing is left claiming to stream.
    expect(subagent.messages).toEqual([
      { text: 'Partial prose cut off by a cancel', order: expect.any(Number) },
    ]);
    store.disconnect();
  });

  it('keeps every final text block from an SDK-native child', async () => {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Explore');
    // An SDK-native subagent streams deltas and a subagent_text final, and
    // never emits subagent_message.
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'task-1',
      text: 'Let me think about this first.',
      delta_kind: 'thinking',
    }, '10');
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'task-1',
      text: 'Found three candidate',
      delta_kind: 'text',
    }, '11');
    emitSse('subagent_text', {
      parent_tool_use_id: 'task-1',
      text: 'Found three candidate lemmas.',
    });
    emitSse('subagent_text', {
      parent_tool_use_id: 'task-1',
      text: 'The strongest candidate is Mathlib.foo.',
    });

    const [subagent] = store.getSnapshot().subagents;
    expect(subagent.text).toBe('The strongest candidate is Mathlib.foo.');
    expect(subagent.messages).toEqual([
      { text: 'Found three candidate lemmas.', order: expect.any(Number) },
      { text: 'The strongest candidate is Mathlib.foo.', order: expect.any(Number) },
    ]);
    store.disconnect();
  });
});

describe('subagent lifecycle edges', () => {
  async function startRun() {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Go');
    return store;
  }

  it('ignores an agent_status for an unknown tool_use_id', async () => {
    const store = await startRun();
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'child-1',
      input: { description: 'Prove Foo', synthetic_for: 'prover' },
    });
    const before = store.getSnapshot().subagents;

    emitSse('agent_status', {
      agent: 'ghost',
      status: 'failed',
      tool_use_id: 'child-does-not-exist',
    });

    const after = store.getSnapshot().subagents;
    expect(after[0].status).toBe('running');
    // No target means no write: the array (and every card memoized on it) is
    // left untouched rather than reallocated per status event.
    expect(after).toBe(before);
    // The hidden status marker is still recorded for the activity log.
    expect(store.getSnapshot().activities.some(
      (activity) => activity.tool === 'ghost' && activity.hidden,
    )).toBe(true);
    store.disconnect();
  });

  it('cancels nested descendants through the live status cascade', async () => {
    const store = await startRun();
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'parent-1',
      input: { description: 'Delegate', synthetic_for: 'delegated-multistep' },
    });
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'child-1',
      parent_tool_use_id: 'parent-1',
      input: { description: 'Write', synthetic_for: 'authoring' },
    });
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'grandchild-1',
      parent_tool_use_id: 'child-1',
      input: { description: 'Survey', synthetic_for: 'explore' },
    });

    emitSse('agent_status', {
      agent: 'Delegate',
      status: 'stopped',
      tool_use_id: 'parent-1',
    });

    expect(Object.fromEntries(store.getSnapshot().subagents.map(
      (subagent) => [subagent.parentToolUseId, subagent.status],
    ))).toEqual({
      'parent-1': 'cancelled',
      'child-1': 'cancelled',
      'grandchild-1': 'cancelled',
    });
    store.disconnect();
  });

  it('materializes a child whose events arrive before its spawn', async () => {
    const store = await startRun();
    // Nothing guarantees the spawning tool_call is delivered before the child's
    // own output: the child posts its events through a separate HTTP path.
    emitSse('subagent_message', {
      parent_tool_use_id: 'child-1',
      text: 'Starting from the statement.',
      message_id: 'message-1',
    }, '10');
    emitSse('tool_call', {
      tool: 'Read',
      tool_use_id: 'read-1',
      parent_tool_use_id: 'child-1',
      input: { file_path: '/tmp/Foo.lean' },
    });
    emitSse('agent_status', {
      agent: 'Formalize Foo',
      status: 'completed',
      tool_use_id: 'child-1',
    });
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'child-1',
      input: {
        description: 'Formalize Foo',
        synthetic_for: 'delegated-multistep',
        status: 'queued',
      },
    });

    const subagents = store.getSnapshot().subagents;
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({
      parentToolUseId: 'child-1',
      description: 'Formalize Foo',
      synthetic: 'delegated-multistep',
      status: 'done',
    });
    expect(subagents[0].messages?.map((message) => message.text)).toEqual([
      'Starting from the statement.',
    ]);
    expect(subagents[0].toolCalls).toHaveLength(1);
    store.disconnect();
  });

  it('labels cancelled delegated work as cancelled, not finished', async () => {
    const store = await startRun();
    emitSse('work_group_status', {
      status: 'cancelled',
      task_count: 3,
      completed_count: 3,
      active_group_count: 0,
      resuming: false,
    });

    expect(store.getSnapshot().liveSession.displayStatus).toBe(
      'Delegated work was cancelled (3/3).',
    );
    store.disconnect();
  });

  it('surfaces delegated integration conflicts distinctly', async () => {
    const store = await startRun();
    emitSse('work_group_status', {
      status: 'failed',
      task_count: 3,
      completed_count: 3,
      active_group_count: 0,
      integration_conflict_count: 1,
      resuming: true,
    });

    expect(store.getSnapshot().liveSession.displayStatus).toBe(
      'Delegated work finished with 1 integration conflict (3/3). Autonomous agent is resuming.',
    );
    store.disconnect();
  });

  it('keeps unchanged slices identical across snapshots', async () => {
    const store = await startRun();
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'child-1',
      input: { description: 'Formalize Foo', synthetic_for: 'delegated-multistep' },
    });
    emitSse('stream_start', { assistant_turn_id: 'turn-0:assistant-0' });
    const before = store.getSnapshot();

    // A streamed orchestrator token must not invalidate the activity and
    // subagent slices; the chat-turn selectors filter + sort the whole
    // (never-trimmed) activity log whenever their identity changes.
    emitSse('stream_delta', { text: 'hel', assistant_turn_id: 'turn-0:assistant-0' });
    emitSse('stream_delta', { text: 'lo', assistant_turn_id: 'turn-0:assistant-0' });

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.activities).toBe(before.activities);
    expect(after.subagents).toBe(before.subagents);

    // A real subagent write still produces a new array.
    emitSse('subagent_message', {
      parent_tool_use_id: 'child-1',
      text: 'Done.',
      message_id: 'message-1',
    }, '11');
    expect(store.getSnapshot().subagents).not.toBe(after.subagents);
    store.disconnect();
  });
});

describe('reconnect through history', () => {
  const historyDetail = {
    id: 'conversation-1',
    status: 'running',
    blueprint_name: 'example',
    created_at: '2026-04-08T12:00:00Z',
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    total_cost_usd: null,
    message_count: 3,
    first_message: 'Go',
    last_message: null,
    last_persisted_event_id: 40,
    messages: [
      {
        id: 'm1', role: 'user', content: 'Go', created_at: '2026-04-08T12:00:00Z',
      },
      {
        id: 'm2',
        role: 'tool',
        content: JSON.stringify({
          kind: 'tool_call',
          tool_use_id: 'child-1',
          tool: 'Agent',
          input: {
            description: 'Formalize Foo',
            synthetic_for: 'delegated-multistep',
            batch_id: 'batch-1',
            launcher_tool: 'authoring-tools',
          },
        }),
        created_at: '2026-04-08T12:00:01Z',
      },
      {
        id: 'm3',
        role: 'tool',
        content: JSON.stringify({
          kind: 'subagent_message',
          parent_tool_use_id: 'child-1',
          text: 'Persisted prose.',
          message_id: 'message-1',
        }),
        created_at: '2026-04-08T12:00:02Z',
      },
    ],
  };

  it('maps persisted message identities and delivery states into chat rows', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      status: 'completed',
      messages: [
        {
          id: 'message-queued',
          role: 'user',
          content: 'Wait for the next turn',
          delivery_state: 'queued',
          created_at: '2026-04-08T12:00:00Z',
        },
        {
          id: 'message-steered',
          role: 'user',
          content: 'Use this now',
          delivery_state: 'steered',
          created_at: '2026-04-08T12:00:01Z',
        },
      ],
    });
    const store = createStore();

    await store.loadHistory('conversation-1');

    expect(store.getSnapshot().messages).toEqual([
      expect.objectContaining({
        messageId: 'message-queued',
        deliveryState: 'queued',
      }),
      expect.objectContaining({
        messageId: 'message-steered',
        deliveryState: 'steered',
      }),
    ]);
  });

  it('reuses recently loaded completed transcripts when switching chats', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockImplementation(
      async (conversationId: string) => ({
        ...historyDetail,
        id: conversationId,
        status: 'completed',
        completed_at: '2026-04-08T12:05:00Z',
      }),
    );
    const store = createStore();

    await store.loadHistory('conversation-1');
    await store.loadHistory('conversation-2');
    await store.loadHistory('conversation-1');

    expect(mocks.fetchSessionHistoryDetail).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().viewingConversationId).toBe('conversation-1');
  });

  it('coalesces overlapping requests for the same transcript', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    let resolveDetail = (_detail: typeof historyDetail): void => undefined;
    mocks.fetchSessionHistoryDetail.mockReturnValue(new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    const store = createStore();

    const firstLoad = store.loadHistory('conversation-1');
    const secondLoad = store.loadHistory('conversation-1');
    await Promise.resolve();
    resolveDetail({ ...historyDetail, status: 'completed' });
    await Promise.all([firstLoad, secondLoad]);

    expect(mocks.fetchSessionHistoryDetail).toHaveBeenCalledOnce();
    expect(store.getSnapshot().viewingConversationId).toBe('conversation-1');
  });

  it('loads and caches a persisted subagent timeline on first expansion', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      status: 'completed',
      subagent_history_lazy: true,
      subagents: [{
        parent_tool_use_id: 'child-1',
        tool_call_count: 1,
        recent_tool_calls: [{
          tool_use_id: 'read-1',
          tool: 'Read',
          input: { file_path: 'Main.lean' },
          created_at: '2026-04-08T12:00:02Z',
        }],
      }],
      messages: historyDetail.messages.slice(0, 2),
    });
    mocks.fetchSubagentHistory.mockResolvedValue({
      parent_tool_use_id: 'child-1',
      messages: [
        {
          id: 'm4',
          role: 'tool',
          content: JSON.stringify({
            kind: 'tool_call',
            tool: 'Read',
            tool_use_id: 'read-1',
            parent_tool_use_id: 'child-1',
            is_subagent: true,
            input: { file_path: 'Main.lean' },
          }),
          created_at: '2026-04-08T12:00:02Z',
        },
        {
          id: 'm5',
          role: 'tool',
          content: JSON.stringify({
            kind: 'tool_result',
            tool_use_id: 'read-1',
            result: 'Permission denied',
            is_error: true,
          }),
          created_at: '2026-04-08T12:00:03Z',
        },
      ],
    });
    const store = createStore();
    await store.loadHistory('conversation-1');

    expect(store.getSnapshot().subagents[0]).toMatchObject({
      parentToolUseId: 'child-1',
      toolCallCount: 1,
      historyLoaded: false,
      toolCalls: [expect.objectContaining({
        tool: 'Read',
        summary: 'Main.lean',
        toolUseId: 'read-1',
        parentToolUseId: 'child-1',
      })],
    });

    await Promise.all([
      store.loadSubagentHistory('child-1'),
      store.loadSubagentHistory('child-1'),
    ]);
    await store.loadSubagentHistory('child-1');

    expect(mocks.fetchSubagentHistory).toHaveBeenCalledOnce();
    expect(store.getSnapshot().subagents[0]).toMatchObject({
      historyLoaded: true,
      historyLoading: false,
      toolCallCount: 1,
    });
    expect(store.getSnapshot().subagents[0].toolCalls).toEqual([
      expect.objectContaining({
        toolUseId: 'read-1',
        isError: true,
        result: 'Permission denied',
      }),
    ]);
  });

  it('finishes an in-flight child timeline when its history is resumed', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      status: 'completed',
      subagent_history_lazy: true,
      subagents: [{
        parent_tool_use_id: 'child-1',
        tool_call_count: 1,
        recent_tool_calls: [],
      }],
      messages: historyDetail.messages.slice(0, 2),
    });
    let resolveTimeline = (_detail: {
      parent_tool_use_id: string;
      messages: PersistedChatMessage[];
    }): void => undefined;
    mocks.fetchSubagentHistory.mockReturnValue(new Promise((resolve) => {
      resolveTimeline = resolve;
    }));
    mocks.createSession.mockResolvedValue({
      ...RUNNING_SESSION,
      conversation_id: 'conversation-1',
    });
    const store = createStore();
    await store.loadHistory('conversation-1');

    const timelineLoad = store.loadSubagentHistory('child-1');
    await Promise.resolve();
    expect(store.getSnapshot().subagents[0].historyLoading).toBe(true);

    await store.send('Resume this conversation');
    resolveTimeline({
      parent_tool_use_id: 'child-1',
      messages: [{
        id: 'm4',
        role: 'tool',
        content: JSON.stringify({
          kind: 'tool_call',
          tool: 'Read',
          tool_use_id: 'read-1',
          parent_tool_use_id: 'child-1',
          is_subagent: true,
          input: { file_path: 'Main.lean' },
        }),
        created_at: '2026-04-08T12:00:02Z',
      }],
    });
    await timelineLoad;

    expect(store.getSnapshot().subagents[0]).toMatchObject({
      historyLoaded: true,
      historyLoading: false,
    });
  });

  it('restores preview calls around nested agent spawns chronologically', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      status: 'completed',
      subagent_history_lazy: true,
      subagents: [{
        parent_tool_use_id: 'child-1',
        tool_call_count: 3,
        recent_tool_calls: [
          {
            tool_use_id: 'read-1',
            tool: 'Read',
            input: { file_path: 'Before.lean' },
            created_at: '2026-04-08T12:00:02Z',
          },
          {
            tool_use_id: 'grep-1',
            tool: 'Grep',
            input: { pattern: 'beforeChild' },
            created_at: '2026-04-08T12:00:03Z',
          },
          {
            tool_use_id: 'glob-1',
            tool: 'Glob',
            input: { pattern: '**/*.lean' },
            created_at: '2026-04-08T12:00:05Z',
          },
        ],
      }],
      messages: [
        historyDetail.messages[0],
        historyDetail.messages[1],
        {
          id: 'm-nested',
          role: 'tool',
          content: JSON.stringify({
            kind: 'tool_call',
            tool: 'Agent',
            tool_use_id: 'nested-1',
            parent_tool_use_id: 'child-1',
            input: { description: 'Survey', synthetic_for: 'explore' },
          }),
          created_at: '2026-04-08T12:00:04Z',
        },
      ],
    });
    const store = createStore();

    await store.loadHistory('conversation-1');

    const parent = store.getSnapshot().subagents.find(
      (subagent) => subagent.parentToolUseId === 'child-1',
    );
    const nested = store.getSnapshot().subagents.find(
      (subagent) => subagent.parentToolUseId === 'nested-1',
    );
    const callOrders = Object.fromEntries(
      parent?.toolCalls.map((call) => [call.toolUseId, call.order]) ?? [],
    );
    expect(callOrders['read-1']).toBeLessThan(nested?.order ?? 0);
    expect(callOrders['grep-1']).toBeLessThan(nested?.order ?? 0);
    expect(callOrders['glob-1']).toBeGreaterThan(nested?.order ?? 0);
  });

  it('keeps live status authoritative over a lagging queued history row', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue({
      ...RUNNING_SESSION,
      conversation_id: 'conversation-1',
      status: 'running',
      event_counter: 60,
      last_persisted_event_id: 40,
    });
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      status: 'queued',
    });
    const store = createStore();

    await store.loadHistory('conversation-1');

    expect(store.getSnapshot().status).toBe('running');
    expect(store.getSnapshot().sessionId).toBe('session-1');
  });

  it('normalizes a static queued job to the starting UI state', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      status: 'queued',
    });
    const store = createStore();

    await store.loadHistory('conversation-1');

    expect(store.getSnapshot().status).toBe('starting');
    expect(store.getSnapshot().sessionId).toBeNull();
  });

  it('replays the live tail onto reconstructed history without duplicating it', async () => {
    mocks.fetchLiveSessionForConversation.mockResolvedValue({
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      agent_job_id: 'job-1',
      status: 'running',
      execution_mode: 'foreground',
      turn_active: true,
      event_counter: 60,
      last_persisted_event_id: 40,
      is_active_session: true,
      can_send: false,
      can_cancel: true,
      build_status: 'done',
      display_status: 'Running autonomously.',
    });
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      ...historyDetail,
      subagent_history_lazy: true,
      subagents: [{
        parent_tool_use_id: 'child-1',
        tool_call_count: 2,
        recent_tool_calls: [{
          tool_use_id: 'read-1',
          tool: 'Read',
          input: { file_path: 'Main.lean' },
          created_at: '2026-04-08T12:00:01.500Z',
        }],
      }],
    });

    const store = createStore();
    await store.loadHistory('conversation-1');

    const restored = store.getSnapshot().subagents;
    expect(restored).toHaveLength(1);
    // Both structured pairing keys survive the reload; without launcherTool the
    // card falls back to the legacy description heuristic.
    expect(restored[0]).toMatchObject({
      batchId: 'batch-1',
      launcherTool: 'authoring-tools',
      status: 'running',
    });
    expect(restored[0].messages?.map((message) => message.text)).toEqual([
      'Persisted prose.',
    ]);
    expect(restored[0].toolCalls).toEqual([
      expect.objectContaining({ toolUseId: 'read-1', summary: 'Main.lean' }),
    ]);

    // loadHistory → attachLiveSession clears appliedSubagentEventIds, so the
    // replayed tail is deduped by message_id, not by SSE event id.
    emitSse('subagent_stream_delta', {
      parent_tool_use_id: 'child-1',
      text: 'Persisted pr',
      delta_kind: 'text',
    }, '41');
    emitSse('subagent_message', {
      parent_tool_use_id: 'child-1',
      text: 'Persisted prose.',
      message_id: 'message-1',
    }, '42');
    emitSse('subagent_message', {
      parent_tool_use_id: 'child-1',
      text: 'Newly streamed prose.',
      message_id: 'message-2',
    }, '43');
    emitSse('tool_call', {
      tool: 'Read',
      tool_use_id: 'read-1',
      parent_tool_use_id: 'child-1',
      input: { file_path: 'Main.lean' },
    });
    emitSse('tool_call', {
      tool: 'Grep',
      tool_use_id: 'grep-2',
      parent_tool_use_id: 'child-1',
      input: { pattern: 'theorem' },
    });
    emitSse('tool_call', {
      tool: 'Agent',
      tool_use_id: 'child-1',
      input: {
        description: 'Formalize Foo',
        synthetic_for: 'delegated-multistep',
        batch_id: 'batch-1',
        launcher_tool: 'authoring-tools',
      },
    });

    const replayed = store.getSnapshot().subagents;
    expect(replayed).toHaveLength(1);
    expect(replayed[0].messages?.map((message) => message.text)).toEqual([
      'Persisted prose.',
      'Newly streamed prose.',
    ]);
    expect(replayed[0].messages?.some((message) => message.streaming)).toBe(false);
    expect(replayed[0].launcherTool).toBe('authoring-tools');
    expect(replayed[0].toolCalls.map((call) => call.toolUseId)).toEqual([
      'read-1',
      'grep-2',
    ]);
    store.disconnect();
  });
});

describe('subagent spawn live/history parity', () => {
  // The backend publishes every spawn it synthesizes itself as `Agent`
  // (app/mcp/child_agent_runtime.py and
  // app/services/agent/runner/prover_batches.py both hardcode the name), and
  // every child-forwarding path drops nested `Agent`/`Task` blocks, so `Task`
  // only reaches the client as a model-issued, non-synthetic spawn. Whichever
  // name arrives, the live handler and history reconstruction must build the
  // same card: a name read as synthetic on one path only changes the card's
  // batch pairing and nesting across a reload.
  const SPAWN_INPUT = {
    description: 'Formalize Foo',
    synthetic_for: 'authoring',
    batch_id: 'batch-1',
    launcher_tool: 'authoring-tools',
    specialist_target: 'lean/Project/Basic.lean',
    status: 'queued',
  };

  /** The spawn-derived fields both paths must reproduce identically. */
  function spawnShape(subagent: SubagentStream | undefined) {
    return {
      parentToolUseId: subagent?.parentToolUseId,
      description: subagent?.description,
      synthetic: subagent?.synthetic,
      batchId: subagent?.batchId,
      launcherTool: subagent?.launcherTool,
      // Dropping this on one path only would merge two specialists after a
      // reload that the live view kept apart (ADR 051).
      specialistTarget: subagent?.specialistTarget,
      parentSubagentId: subagent?.parentSubagentId,
      status: subagent?.status,
    };
  }

  async function liveSpawn(tool: string) {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Go');
    emitSse('tool_call', {
      tool,
      tool_use_id: 'child-1',
      input: SPAWN_INPUT,
    });
    const shape = spawnShape(store.getSnapshot().subagents[0]);
    store.disconnect();
    return shape;
  }

  async function reloadedSpawn(tool: string) {
    mocks.fetchLiveSessionForConversation.mockResolvedValue(undefined);
    mocks.fetchSessionHistoryDetail.mockResolvedValue({
      id: 'conversation-1',
      status: 'running',
      blueprint_name: 'example',
      created_at: '2026-04-08T12:00:00Z',
      completed_at: null,
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: null,
      message_count: 2,
      first_message: 'Go',
      last_message: null,
      last_persisted_event_id: 40,
      messages: [
        {
          id: 'm1', role: 'user', content: 'Go', created_at: '2026-04-08T12:00:00Z',
        },
        {
          id: 'm2',
          role: 'tool',
          content: JSON.stringify({
            kind: 'tool_call',
            tool_use_id: 'child-1',
            tool,
            input: SPAWN_INPUT,
          }),
          created_at: '2026-04-08T12:00:01Z',
        },
      ],
    });

    const store = createStore();
    await store.loadHistory('conversation-1');
    return spawnShape(store.getSnapshot().subagents[0]);
  }

  it.each(['Agent', 'Task'])(
    'builds the same card for a %s spawn live and after a reload',
    async (tool) => {
      const live = await liveSpawn(tool);
      expect(live.parentToolUseId).toBe('child-1');
      // Only an `Agent` spawn is synthetic, so only it carries the synthetic
      // metadata; what matters is that both paths agree on that either way.
      expect(live.specialistTarget).toBe(
        tool === 'Agent' ? 'lean/Project/Basic.lean' : undefined,
      );
      expect(await reloadedSpawn(tool)).toEqual(live);
    },
  );
});

describe('permission prompts', () => {
  const PROMPT = {
    request_id: 'perm-1',
    tool: 'Bash',
    input: { command: 'lake build' },
    description: 'Run lake build',
    reason: 'Bash needs approval',
    suggestions: [
      { label: 'Always allow lake build', payload: { rule: 'Bash(lake build:*)' } },
    ],
    tool_use_id: 'tool-1',
    assistant_turn_id: 'turn-0:assistant-0',
  };

  async function startRunningSession() {
    mocks.createSession.mockResolvedValue(RUNNING_SESSION);
    const store = createStore();
    await store.send('Prove this');
    return store;
  }

  it('parks the paused tool call next to its row and updates the status line', async () => {
    const store = await startRunningSession();
    emitSse('tool_call', {
      tool: 'Bash',
      input: { command: 'lake build' },
      tool_use_id: 'tool-1',
    }, '3');
    emitSse('permission_request', PROMPT, '4');

    const state = store.getSnapshot();
    expect(state.permissions).toHaveLength(1);
    const [prompt] = state.permissions;
    expect(prompt).toMatchObject({
      request_id: 'perm-1',
      tool: 'Bash',
      input: { command: 'lake build' },
      description: 'Run lake build',
      reason: 'Bash needs approval',
      tool_use_id: 'tool-1',
      assistant_turn_id: 'turn-0:assistant-0',
    });
    expect(prompt.suggestions).toEqual([
      { label: 'Always allow lake build', payload: { rule: 'Bash(lake build:*)' } },
    ]);
    // Anchored exactly like the tool row so the panel can place the card beside it.
    const activity = state.activities.find((item) => item.toolUseId === 'tool-1');
    expect(activity).toBeDefined();
    expect(prompt.anchorTurnId).toBe(activity?.anchorTurnId);
    expect(prompt.anchorAfterMessageCount).toBe(activity?.anchorAfterMessageCount);
    expect(prompt.order).toBe(activity?.order);
    expect(state.liveSession.displayStatus).toBe('Waiting for your approval.');
    // A paused turn is still an active turn: Stop and steering stay available.
    expect(state.liveSession.turnActive).toBe(true);
  });

  it('ignores replays of a prompt it already holds and malformed payloads', async () => {
    const store = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    emitSse('permission_request', PROMPT, '3');
    emitSse('permission_request', { tool: 'Bash' }, '4');
    emitSse('permission_request', { request_id: 'perm-2', suggestions: 'nope' }, '5');

    const state = store.getSnapshot();
    expect(state.permissions.map((prompt) => prompt.request_id)).toEqual(['perm-1', 'perm-2']);
    expect(state.permissions[1]).toMatchObject({
      tool: 'Tool',
      input: {},
      description: null,
      reason: null,
      suggestions: [],
      tool_use_id: null,
      assistant_turn_id: null,
    });
  });

  it('anchors a prompt without a known tool row at the current turn position', async () => {
    const store = await startRunningSession();
    emitSse('permission_request', { ...PROMPT, tool_use_id: undefined }, '3');
    const [prompt] = store.getSnapshot().permissions;
    expect(prompt.tool_use_id).toBeNull();
    expect(prompt.anchorTurnId).toBe('turn-0');
    expect(prompt.anchorAfterMessageCount).toBe(0);
    expect(typeof prompt.order).toBe('number');
  });

  it('drops a prompt on permission_resolved and restores the running status', async () => {
    const store = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    emitSse('permission_request', { ...PROMPT, request_id: 'perm-2' }, '4');
    emitSse('permission_resolved', { request_id: 'perm-1', behavior: 'allow' }, '5');
    expect(store.getSnapshot().permissions.map((prompt) => prompt.request_id))
      .toEqual(['perm-2']);
    expect(store.getSnapshot().liveSession.displayStatus).toBe('Waiting for your approval.');
    emitSse('permission_resolved', { request_id: 'perm-2', behavior: 'deny' }, '6');
    expect(store.getSnapshot().permissions).toEqual([]);
    expect(store.getSnapshot().liveSession.displayStatus).toBe('Running autonomously.');
  });

  it('sends the decision and removes the card optimistically', async () => {
    const store = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    let resolveRequest!: (value: { status: string }) => void;
    mocks.respondPermissionRequest.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const pending = store.respondPermission('perm-1', {
      behavior: 'allow',
      suggestion: { rule: 'Bash(lake build:*)' },
    });
    expect(store.getSnapshot().permissions).toEqual([]);
    expect(mocks.respondPermissionRequest).toHaveBeenCalledWith('session-1', 'perm-1', {
      behavior: 'allow',
      suggestion: { rule: 'Bash(lake build:*)' },
    });
    resolveRequest({ status: 'accepted' });
    await pending;
    expect(store.getSnapshot().permissions).toEqual([]);
    expect(store.getSnapshot().liveSession.displayStatus).toBe('Running autonomously.');
  });

  it('restores the card and reports the failure when the decision is rejected', async () => {
    const store = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    mocks.respondPermissionRequest.mockRejectedValue(new Error('CLI went away'));

    await store.respondPermission('perm-1', { behavior: 'deny' });

    const state = store.getSnapshot();
    expect(state.permissions.map((prompt) => prompt.request_id)).toEqual(['perm-1']);
    expect(state.liveSession.displayStatus).toBe('Waiting for your approval.');
    expect(state.messages.at(-1)).toMatchObject({ isError: true, text: 'CLI went away' });
  });

  it('treats a 409 on the decision as an already-settled prompt', async () => {
    const store = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    mocks.respondPermissionRequest.mockRejectedValue(new ApiError('gone', 409));

    await store.respondPermission('perm-1', { behavior: 'allow' });

    expect(store.getSnapshot().permissions).toEqual([]);
    expect(store.getSnapshot().messages.some((message) => message.isError)).toBe(false);
  });

  it('ignores a decision for an unknown request', async () => {
    const store = await startRunningSession();
    await store.respondPermission('missing', { behavior: 'allow' });
    expect(mocks.respondPermissionRequest).not.toHaveBeenCalled();
  });

  it('clears prompts when the turn ends, the session ends, or the chat is stopped', async () => {
    const endedByTurn = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    emitSse('turn_status', { turn_active: false }, '4');
    expect(endedByTurn.getSnapshot().permissions).toEqual([]);

    const endedBySession = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    mocks.fetchLiveSessionForConversation.mockRejectedValue(new ApiError('gone', 404));
    mocks.fetchSessionHistoryDetail.mockResolvedValue(persistedRunningStart());
    emitSse('session_end', { status: 'completed' }, '4');
    expect(endedBySession.getSnapshot().permissions).toEqual([]);

    const stopped = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    await stopped.stop();
    expect(stopped.getSnapshot().permissions).toEqual([]);

    const fresh = await startRunningSession();
    emitSse('permission_request', PROMPT, '3');
    await fresh.prepareNewAgentSession();
    expect(fresh.getSnapshot().permissions).toEqual([]);
  });
});
