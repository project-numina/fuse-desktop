import { ApiError, respondPermissionRequest } from '@/lib/api';
import type { PermissionDecisionBody } from '@/lib/api';
import { objectPayload, parseSseEventData } from './sse';
import type {
  ChatState,
  PermissionPrompt,
  PermissionSuggestion,
} from './types';

const PERMISSION_WAITING_STATUS = 'Waiting for your approval.';
const PERMISSION_RESUMED_STATUS = 'Running autonomously.';

interface PermissionStateDependencies {
  state: ChatState;
  emit: () => void;
  currentTurnContext: () => {
    turnId: string | null;
    assistantMessageCount: number;
  };
  nextActivityOrder: () => number;
  scrollToLatest: () => void;
}

interface PermissionRequestData {
  [key: string]: unknown;
  request_id?: unknown;
  tool?: unknown;
  input?: unknown;
  description?: unknown;
  reason?: unknown;
  suggestions?: unknown;
  tool_use_id?: unknown;
  assistant_turn_id?: unknown;
}

function parseSuggestions(value: unknown): PermissionSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const record = objectPayload(entry);
    const label = typeof record.label === 'string' && record.label.trim()
      ? record.label
      : `Option ${index + 1}`;
    return { label, payload: record.payload };
  });
}

function removePermission(
  state: ChatState,
  requestId: string,
): PermissionPrompt | null {
  const index = state.permissions.findIndex(
    (prompt) => prompt.request_id === requestId,
  );
  if (index === -1) return null;
  const [removed] = state.permissions.slice(index, index + 1);
  state.permissions = [
    ...state.permissions.slice(0, index),
    ...state.permissions.slice(index + 1),
  ];
  if (
    state.permissions.length === 0
    && state.liveSession.displayStatus === PERMISSION_WAITING_STATUS
  ) {
    state.liveSession = {
      ...state.liveSession,
      displayStatus: PERMISSION_RESUMED_STATUS,
    };
  }
  return removed;
}

function createPrompt(
  dependencies: PermissionStateDependencies,
  data: PermissionRequestData & { request_id: string },
): PermissionPrompt {
  const { state, currentTurnContext, nextActivityOrder } = dependencies;
  const { turnId, assistantMessageCount } = currentTurnContext();
  const toolUseId = typeof data.tool_use_id === 'string' ? data.tool_use_id : null;
  const pausedActivity = toolUseId
    ? state.activities.find((activity) => activity.toolUseId === toolUseId)
    : undefined;
  return {
    request_id: data.request_id,
    tool: typeof data.tool === 'string' && data.tool ? data.tool : 'Tool',
    input: objectPayload(data.input),
    description: typeof data.description === 'string' ? data.description : null,
    reason: typeof data.reason === 'string' ? data.reason : null,
    suggestions: parseSuggestions(data.suggestions),
    tool_use_id: toolUseId,
    assistant_turn_id: typeof data.assistant_turn_id === 'string'
      ? data.assistant_turn_id
      : null,
    anchorTurnId: pausedActivity?.anchorTurnId ?? turnId,
    anchorAfterMessageCount: pausedActivity?.anchorAfterMessageCount
      ?? assistantMessageCount,
    order: pausedActivity?.order ?? nextActivityOrder(),
  };
}

function restorePermission(
  state: ChatState,
  requestId: string,
  removed: PermissionPrompt,
): void {
  if (state.permissions.some((prompt) => prompt.request_id === requestId)) return;
  state.permissions = [...state.permissions, removed].sort(
    (left, right) => left.order - right.order,
  );
  state.liveSession = {
    ...state.liveSession,
    displayStatus: PERMISSION_WAITING_STATUS,
  };
}

function isAlreadyResolvedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}

class PermissionStateController {
  constructor(private readonly dependencies: PermissionStateDependencies) {}

  handleRequest(event: Event): void {
    const data = parseSseEventData<PermissionRequestData>(event);
    if (!data || typeof data.request_id !== 'string' || !data.request_id) return;
    const { state, emit, scrollToLatest } = this.dependencies;
    if (state.permissions.some((prompt) => prompt.request_id === data.request_id)) {
      return;
    }
    const prompt = createPrompt(this.dependencies, {
      ...data,
      request_id: data.request_id,
    });
    state.permissions = [...state.permissions, prompt];
    state.liveSession = {
      ...state.liveSession,
      displayStatus: PERMISSION_WAITING_STATUS,
    };
    emit();
    scrollToLatest();
  }

  handleResolved(event: Event): void {
    const data = parseSseEventData<{ request_id?: unknown }>(event);
    if (!data || typeof data.request_id !== 'string') return;
    removePermission(this.dependencies.state, data.request_id);
    this.dependencies.emit();
  }

  async respond(
    requestId: string,
    decision: PermissionDecisionBody,
  ): Promise<void> {
    const { state, emit } = this.dependencies;
    const sessionId = state.sessionId;
    const removed = removePermission(state, requestId);
    if (!removed) return;
    emit();
    if (!sessionId) return;
    try {
      await respondPermissionRequest(sessionId, requestId, decision);
    } catch (decisionError) {
      if (isAlreadyResolvedError(decisionError)) return;
      restorePermission(state, requestId, removed);
      state.messages.push({
        role: 'agent',
        text: decisionError instanceof Error
          ? decisionError.message
          : String(decisionError),
        isError: true,
      });
      emit();
    }
  }
}

/** Owns the optimistic permission-prompt lifecycle for one chat store. */
export function createPermissionState(dependencies: PermissionStateDependencies) {
  const controller = new PermissionStateController(dependencies);
  return {
    handleRequest: (event: Event) => controller.handleRequest(event),
    handleResolved: (event: Event) => controller.handleResolved(event),
    respond: (requestId: string, decision: PermissionDecisionBody) => (
      controller.respond(requestId, decision)
    ),
  };
}
