import type { PermissionDecision, PermissionSuggestion } from '@shared/agent-events';
import { asRecord, asString, now, type EventSink } from '../types';

type ProtocolWriter = (payload: unknown) => void;

interface PendingPermission {
  turnId: string;
  input: Record<string, unknown>;
}

/** Owns the request/response correlation required by Claude's stdio prompts. */
export class ClaudePermissionController {
  private readonly pending = new Map<string, PendingPermission>();

  constructor(
    private readonly emit: EventSink,
    private readonly write: ProtocolWriter,
  ) {}

  respond(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: permissionResponse(decision, pending.input),
      },
    });
    this.emit({
      kind: 'permission_resolved',
      turnId: pending.turnId,
      requestId,
      behavior: decision.behavior,
      at: now(),
    });
    return true;
  }

  handleRequest(record: Record<string, unknown>, turnId: string | null): void {
    const requestId = asString(record.request_id);
    const request = asRecord(record.request);
    if (!requestId) return;
    if (asString(request.subtype) !== 'can_use_tool') {
      this.acknowledgeUnknownRequest(requestId);
      return;
    }
    if (!turnId) {
      this.denyInactiveRequest(requestId);
      return;
    }
    const input = asRecord(request.input);
    this.pending.set(requestId, { turnId, input });
    this.emitPermissionRequest(requestId, request, input, turnId);
  }

  /** Expire prompts when their turn ends so late UI responses are rejected. */
  expire(turnId: string): void {
    for (const requestId of this.pending.keys()) {
      this.emit({ kind: 'permission_resolved', turnId, requestId, behavior: 'deny', at: now() });
    }
    this.pending.clear();
  }

  private emitPermissionRequest(
    requestId: string,
    request: Record<string, unknown>,
    input: Record<string, unknown>,
    turnId: string,
  ): void {
    this.emit({
      kind: 'permission_request',
      turnId,
      requestId,
      toolCallId: asString(request.tool_use_id),
      tool: asString(request.tool_name) ?? 'tool',
      input,
      description: asString(request.description),
      reason: asString(request.decision_reason),
      suggestions: permissionSuggestions(request.permission_suggestions),
      at: now(),
    });
  }

  private acknowledgeUnknownRequest(requestId: string): void {
    // Unknown host requests are acknowledged so the CLI never hangs waiting.
    this.write({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: {} },
    });
  }

  private denyInactiveRequest(requestId: string): void {
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { behavior: 'deny', message: 'No active turn.' },
      },
    });
  }
}

function permissionResponse(decision: PermissionDecision, input: Record<string, unknown>): Record<string, unknown> {
  if (decision.behavior === 'deny') {
    return { behavior: 'deny', message: decision.message ?? 'The user declined this action.' };
  }
  return {
    behavior: 'allow',
    updatedInput: input,
    ...(decision.suggestion === undefined ? {} : { updatedPermissions: [decision.suggestion] }),
  };
}

export function permissionSuggestions(value: unknown): PermissionSuggestion[] {
  if (!Array.isArray(value)) return [];
  const suggestions: PermissionSuggestion[] = [];
  for (const raw of value) {
    const suggestion = asRecord(raw);
    if (asString(suggestion.type) !== 'addRules' || suggestion.behavior !== 'allow') continue;
    const labels = permissionRuleLabels(suggestion.rules);
    if (labels.length === 0) continue;
    const scope = asString(suggestion.destination) === 'session' ? 'this session' : 'always';
    suggestions.push({ label: `Allow ${labels.join(', ')} for ${scope}`, payload: suggestion });
  }
  return suggestions;
}

function permissionRuleLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((rule) => {
    const record = asRecord(rule);
    const tool = asString(record.toolName) ?? 'tool';
    const content = asString(record.ruleContent);
    return content ? `${tool}(${content})` : tool;
  });
}
