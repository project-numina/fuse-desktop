import { randomUUID } from 'node:crypto';
import type { AgentEvent, UsageSnapshot } from '@shared/agent-events';
import { ClaudePermissionController } from './permissions';
import { asNumber, asRecord, asString, now, type EventSink } from '../types';

interface StreamingBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_use';
  text: string;
  /** A text block already announced as completed by either protocol line. */
  reported?: boolean;
}

export interface ClaudeEventCallbacks {
  currentTurnId(): string | null;
  onThreadStarted(sessionId: string, model: string | null): void;
  finishTurn(event: AgentEvent): void;
  interruptRequested(): boolean;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/** Translates Claude's provider protocol into the app's normalized events. */
export class ClaudeEventTranslator {
  private readonly seenToolCalls = new Set<string>();
  private readonly completedTextBlocks = new Map<string, string[]>();
  /** Spawning tool call id to subagent type, paired across task lines. */
  private readonly taskAgentTypes = new Map<string, string>();
  private blocks = new Map<number, StreamingBlock>();
  private currentMessageId: string | null = null;

  constructor(
    private readonly emit: EventSink,
    private readonly permissions: ClaudePermissionController,
    private readonly callbacks: ClaudeEventCallbacks,
  ) {}

  handleLine(value: unknown): void {
    const record = asRecord(value);
    switch (asString(record.type)) {
      case 'system':
        this.handleSystem(record);
        return;
      case 'stream_event':
        this.handleStreamEvent(asRecord(record.event), asString(record.parent_tool_use_id));
        return;
      case 'assistant':
        this.handleAssistant(asRecord(record.message), asString(record.parent_tool_use_id));
        return;
      case 'user':
        this.handleUser(asRecord(record.message));
        return;
      case 'control_request':
        this.permissions.handleRequest(record, this.callbacks.currentTurnId());
        return;
      case 'result':
        this.handleResult(record);
        return;
      default:
        // control_response and rate_limit_event need no host-side action.
        return;
    }
  }

  resetTurn(): void {
    this.blocks = new Map();
    this.currentMessageId = null;
    this.taskAgentTypes.clear();
  }

  resetProcess(): void {
    this.blocks = new Map();
  }

  private handleSystem(record: Record<string, unknown>): void {
    const subtype = asString(record.subtype);
    if (subtype === 'init') {
      this.handleInitialization(record);
    } else if (subtype === 'permission_denied') {
      const message = asString(record.message);
      if (message) this.callbacks.log('warn', message);
    } else if (subtype === 'task_started') {
      this.handleTaskStarted(record);
    } else if (subtype === 'task_notification') {
      this.handleTaskNotification(record);
    }
  }

  private handleInitialization(record: Record<string, unknown>): void {
    // A resume announces the same id again; the model is only known here.
    const sessionId = asString(record.session_id);
    if (sessionId) this.callbacks.onThreadStarted(sessionId, asString(record.model));
  }

  private handleTaskStarted(record: Record<string, unknown>): void {
    const turnId = this.callbacks.currentTurnId();
    if (!turnId) return;
    const toolCallId = asString(record.tool_use_id);
    const taskType = asString(record.task_type);
    const agentType = asString(record.subagent_type) ?? asString(record.agent_type);
    const isAgent = taskType === 'local_agent' || (taskType === null && agentType !== null);
    if (!isAgent || !toolCallId) return;
    const agent = agentType ?? 'agent';
    this.taskAgentTypes.set(toolCallId, agent);
    this.emit({ kind: 'agent_status', turnId, toolCallId, agent, status: 'running', at: now() });
  }

  private handleTaskNotification(record: Record<string, unknown>): void {
    const turnId = this.callbacks.currentTurnId();
    if (!turnId) return;
    const toolCallId = asString(record.tool_use_id);
    const agent = toolCallId ? this.taskAgentTypes.get(toolCallId) : undefined;
    if (!toolCallId || agent === undefined) return;
    this.taskAgentTypes.delete(toolCallId);
    this.emit({
      kind: 'agent_status',
      turnId,
      toolCallId,
      agent,
      status: asString(record.status) ?? 'unknown',
      at: now(),
    });
  }

  private handleStreamEvent(event: Record<string, unknown>, parentToolUseId: string | null): void {
    const turnId = this.callbacks.currentTurnId();
    if (!turnId) return;
    if (parentToolUseId) {
      this.handleSubagentDelta(event, parentToolUseId, turnId);
      return;
    }
    this.handleTopLevelStreamEvent(event, turnId);
  }

  /** Child prose streams without the block lifecycle of the parent message. */
  private handleSubagentDelta(event: Record<string, unknown>, parentToolCallId: string, turnId: string): void {
    if (asString(event.type) !== 'content_block_delta') return;
    const delta = asRecord(event.delta);
    const deltaType = asString(delta.type);
    const deltaKind = deltaType === 'text_delta' ? 'text' : deltaType === 'thinking_delta' ? 'thinking' : null;
    if (!deltaKind) return;
    const text = asString(deltaKind === 'text' ? delta.text : delta.thinking) ?? '';
    if (!text) return;
    this.emit({
      kind: 'subagent_text_delta',
      turnId,
      parentToolCallId,
      text,
      deltaKind,
      at: now(),
    });
  }

  private handleTopLevelStreamEvent(event: Record<string, unknown>, turnId: string): void {
    const type = asString(event.type);
    if (type === 'message_start') {
      this.currentMessageId = asString(asRecord(event.message).id) ?? randomUUID();
      this.blocks = new Map();
      this.emit({ kind: 'assistant_message_started', turnId, at: now() });
      return;
    }
    const index = asNumber(event.index);
    if (index === null) return;
    if (type === 'content_block_start') this.startBlock(index, asRecord(event.content_block));
    else if (type === 'content_block_delta') this.applyBlockDelta(index, asRecord(event.delta), turnId);
    else if (type === 'content_block_stop') this.stopBlock(index, turnId);
  }

  private startBlock(index: number, content: Record<string, unknown>): void {
    const blockType = asString(content.type);
    if (blockType !== 'text' && blockType !== 'thinking' && blockType !== 'tool_use') return;
    this.blocks.set(index, {
      id: `${this.currentMessageId ?? 'msg'}:${index}`,
      type: blockType,
      text: '',
    });
  }

  private applyBlockDelta(index: number, delta: Record<string, unknown>, turnId: string): void {
    const block = this.blocks.get(index);
    if (!block) return;
    const deltaType = asString(delta.type);
    if (block.type === 'text' && deltaType === 'text_delta') {
      const text = asString(delta.text) ?? '';
      if (!text) return;
      block.text += text;
      this.emit({ kind: 'assistant_text_delta', turnId, blockId: block.id, text, at: now() });
    } else if (block.type === 'thinking' && deltaType === 'thinking_delta') {
      const text = asString(delta.thinking) ?? '';
      if (!text) return;
      block.text += text;
      this.emit({ kind: 'thinking_delta', turnId, blockId: block.id, text, at: now() });
    }
  }

  private stopBlock(index: number, turnId: string): void {
    const block = this.blocks.get(index);
    if (!block) return;
    if (block.type === 'text') {
      // The complete assistant line and stop event can arrive in either order.
      if (block.reported) return;
      block.reported = true;
      this.rememberCompletedText(block.text);
      this.emit({ kind: 'assistant_text_completed', turnId, blockId: block.id, text: block.text, at: now() });
    } else if (block.type === 'thinking') {
      this.emit({ kind: 'thinking_completed', turnId, blockId: block.id, at: now() });
    }
  }

  private rememberCompletedText(text: string): void {
    const key = this.currentMessageId ?? 'msg';
    const list = this.completedTextBlocks.get(key) ?? [];
    list.push(text);
    this.completedTextBlocks.set(key, list);
  }

  private handleAssistant(message: Record<string, unknown>, parentToolUseId: string | null): void {
    const turnId = this.callbacks.currentTurnId();
    if (!turnId) return;
    const content = Array.isArray(message.content) ? message.content : [];
    const messageId = asString(message.id) ?? 'msg';
    for (const raw of content) {
      const block = asRecord(raw);
      const type = asString(block.type);
      if (type === 'tool_use') this.emitToolCall(block, parentToolUseId, turnId);
      else if (type === 'text' && parentToolUseId) this.emitSubagentText(block, parentToolUseId, messageId, turnId);
      else if (type === 'text') this.emitAssistantText(block, messageId, turnId);
    }
    const error = asString(message.error);
    if (error) this.callbacks.log('error', error);
  }

  private emitToolCall(block: Record<string, unknown>, parentToolCallId: string | null, turnId: string): void {
    const toolCallId = asString(block.id);
    if (!toolCallId || this.seenToolCalls.has(toolCallId)) return;
    this.seenToolCalls.add(toolCallId);
    this.emit({
      kind: 'tool_call_started',
      turnId,
      toolCallId,
      tool: asString(block.name) ?? 'tool',
      input: asRecord(block.input),
      parentToolCallId,
      at: now(),
    });
  }

  private emitSubagentText(block: Record<string, unknown>, parentToolCallId: string, messageId: string, turnId: string): void {
    const text = asString(block.text) ?? '';
    if (!text.trim()) return;
    this.emit({ kind: 'subagent_text_completed', turnId, parentToolCallId, text, messageId, at: now() });
  }

  private emitAssistantText(block: Record<string, unknown>, messageId: string, turnId: string): void {
    const text = asString(block.text) ?? '';
    const streaming = [...this.blocks.values()].find(
      (entry) => entry.type === 'text' && !entry.reported && entry.text === text,
    );
    if (streaming) {
      streaming.reported = true;
      this.rememberCompletedText(text);
      this.emit({ kind: 'assistant_text_completed', turnId, blockId: streaming.id, text, at: now() });
      return;
    }
    if (this.consumeCompletedText(messageId, text) || !text.trim()) return;
    this.emit({
      kind: 'assistant_text_completed',
      turnId,
      blockId: `${messageId}:full:${randomUUID()}`,
      text,
      at: now(),
    });
  }

  private consumeCompletedText(messageId: string, text: string): boolean {
    const streamed = this.completedTextBlocks.get(messageId) ?? [];
    const position = streamed.indexOf(text);
    if (position < 0) return false;
    streamed.splice(position, 1);
    return true;
  }

  private handleUser(message: Record<string, unknown>): void {
    const turnId = this.callbacks.currentTurnId();
    if (!turnId) return;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (asString(block.type) !== 'tool_result') continue;
      const toolCallId = asString(block.tool_use_id);
      if (!toolCallId) continue;
      this.emit({
        kind: 'tool_call_completed',
        turnId,
        toolCallId,
        result: toolResultText(block.content),
        isError: block.is_error === true,
        at: now(),
      });
    }
  }

  private handleResult(record: Record<string, unknown>): void {
    const turnId = this.callbacks.currentTurnId();
    if (!turnId) return;
    const usage = usageFromResult(record);
    if (usage) this.emit({ kind: 'usage', turnId, usage, at: now() });
    if (this.callbacks.interruptRequested()) {
      this.callbacks.finishTurn({ kind: 'turn_interrupted', turnId, at: now() });
    } else if (record.is_error === true) {
      this.callbacks.finishTurn({ kind: 'turn_failed', turnId, message: resultError(record), at: now() });
    } else {
      this.callbacks.finishTurn({
        kind: 'turn_completed',
        turnId,
        stopReason: asString(record.stop_reason) ?? asString(record.subtype),
        durationMs: asNumber(record.duration_ms),
        costUsd: asNumber(record.total_cost_usd),
        at: now(),
      });
    }
  }
}

function resultError(record: Record<string, unknown>): string {
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
  return (
    asString(record.result) ??
    asString(record.error) ??
    (errors.length ? errors.join('\n') : null) ??
    asString(record.subtype) ??
    'The turn failed.'
  );
}

function toolResultText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (asString(block.type) !== 'text') continue;
    const text = asString(block.text);
    if (text) parts.push(text);
  }
  return parts.length ? parts.join('\n') : null;
}

function usageFromResult(record: Record<string, unknown>): UsageSnapshot | null {
  const usage = asRecord(record.usage);
  if (Object.keys(usage).length === 0) return null;
  let contextWindow: number | null = null;
  for (const raw of Object.values(asRecord(record.modelUsage))) {
    contextWindow = asNumber(asRecord(raw).contextWindow) ?? contextWindow;
  }
  return {
    inputTokens: asNumber(usage.input_tokens) ?? 0,
    outputTokens: asNumber(usage.output_tokens) ?? 0,
    cachedInputTokens: asNumber(usage.cache_read_input_tokens) ?? 0,
    cacheCreationInputTokens: asNumber(usage.cache_creation_input_tokens) ?? 0,
    reasoningOutputTokens: asNumber(asRecord(usage.output_tokens_details).thinking_tokens) ?? 0,
    costUsd: asNumber(record.total_cost_usd),
    contextWindow,
  };
}
