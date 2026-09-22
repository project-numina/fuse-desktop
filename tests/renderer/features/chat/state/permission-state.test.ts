import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialChatState } from '@/features/chat/state/message-state';
import { createPermissionState } from '@/features/chat/state/permission-state';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  respondPermissionRequest: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  respondPermissionRequest: mocks.respondPermissionRequest,
}));

const event = (data: unknown): Event => ({
  data: JSON.stringify(data),
}) as unknown as Event;

function permissionRequest(requestId: string, overrides = {}) {
  return event({
    request_id: requestId,
    tool: 'Bash',
    tool_use_id: `tool-${requestId}`,
    suggestions: [{ payload: 'allow' }],
    ...overrides,
  });
}

describe('permission state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.respondPermissionRequest.mockResolvedValue({ status: 'accepted' });
  });

  it('anchors, deduplicates, and resolves permission prompts in event order', () => {
    const state = createInitialChatState();
    state.activities = [{
      tool: 'Bash', summary: 'Run', toolUseId: 'tool-permission-1',
      anchorTurnId: 'turn-0', anchorAfterMessageCount: 1, order: 4,
    }];
    const lifecycle: string[] = [];
    const controller = createPermissionState({
      state,
      emit: () => lifecycle.push('emit'),
      currentTurnContext: () => ({ turnId: 'fallback', assistantMessageCount: 9 }),
      nextActivityOrder: () => 10,
      scrollToLatest: () => lifecycle.push('scroll'),
    });
    const request = permissionRequest('permission-1');

    controller.handleRequest(request);
    controller.handleRequest(request);
    expect(state.permissions).toHaveLength(1);
    expect(state.permissions[0]).toMatchObject({
      anchorTurnId: 'turn-0', anchorAfterMessageCount: 1, order: 4,
      suggestions: [{ label: 'Option 1', payload: 'allow' }],
    });
    controller.handleResolved(event({ request_id: 'permission-1' }));

    expect(lifecycle).toEqual(['emit', 'scroll', 'emit']);
    expect(state.permissions).toEqual([]);
    expect(state.liveSession.displayStatus).toBe('Running autonomously.');
  });

  it('removes and emits before sending a permission decision', async () => {
    const state = createInitialChatState();
    state.sessionId = 'session-1';
    const lifecycle: string[] = [];
    const controller = createPermissionState({
      state,
      emit: () => lifecycle.push(`emit:${state.permissions.length}`),
      currentTurnContext: () => ({ turnId: 'turn-1', assistantMessageCount: 2 }),
      nextActivityOrder: () => 3,
      scrollToLatest: vi.fn(),
    });
    controller.handleRequest(permissionRequest('permission-1'));
    lifecycle.length = 0;
    mocks.respondPermissionRequest.mockImplementation(async () => {
      lifecycle.push(`api:${state.permissions.length}`);
      return { status: 'accepted' };
    });

    await controller.respond('permission-1', {
      behavior: 'allow',
      suggestion: { type: 'allow-command', command: 'npm test' },
    });

    expect(lifecycle).toEqual(['emit:0', 'api:0']);
    expect(mocks.respondPermissionRequest).toHaveBeenCalledWith(
      'session-1',
      'permission-1',
      {
        behavior: 'allow',
        suggestion: { type: 'allow-command', command: 'npm test' },
      },
    );
    expect(state.liveSession.displayStatus).toBe('Running autonomously.');
  });

  it('restores a failed decision by activity order before reporting the error', async () => {
    const state = createInitialChatState();
    state.sessionId = 'session-1';
    const lifecycle: string[] = [];
    const nextActivityOrder = vi.fn()
      .mockReturnValueOnce(7)
      .mockReturnValueOnce(3);
    const controller = createPermissionState({
      state,
      emit: () => lifecycle.push([
        state.permissions.map((prompt) => prompt.request_id).join(','),
        state.messages.at(-1)?.text ?? '',
      ].join('|')),
      currentTurnContext: () => ({ turnId: null, assistantMessageCount: 0 }),
      nextActivityOrder,
      scrollToLatest: vi.fn(),
    });
    controller.handleRequest(permissionRequest('later'));
    controller.handleRequest(permissionRequest('earlier'));
    lifecycle.length = 0;
    mocks.respondPermissionRequest.mockRejectedValue(new Error('CLI went away'));

    await controller.respond('later', { behavior: 'deny' });

    expect(lifecycle).toEqual([
      'earlier|',
      'earlier,later|CLI went away',
    ]);
    expect(state.liveSession.displayStatus).toBe('Waiting for your approval.');
    expect(state.messages.at(-1)).toMatchObject({
      role: 'agent', text: 'CLI went away', isError: true,
    });
  });

  it('keeps an already-resolved 409 decision removed without an error', async () => {
    const state = createInitialChatState();
    state.sessionId = 'session-1';
    const emit = vi.fn();
    const controller = createPermissionState({
      state,
      emit,
      currentTurnContext: () => ({ turnId: null, assistantMessageCount: 0 }),
      nextActivityOrder: () => 1,
      scrollToLatest: vi.fn(),
    });
    controller.handleRequest(permissionRequest('permission-1'));
    emit.mockClear();
    mocks.respondPermissionRequest.mockRejectedValue(new ApiError('gone', 409));

    await controller.respond('permission-1', { behavior: 'allow' });

    expect(state.permissions).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(emit).toHaveBeenCalledOnce();
  });
});
