import type { AgentEvent } from '@shared/agent-events';
import { touchesLeanFile, TurnLivenessTracker } from './event-state';
import type { SessionTranscript } from './transcript';
import type { TurnRecord } from './types';
import { summarizeToolInput, summarizeToolResult } from '../tool-summaries';

interface SessionToolEventsInit {
  transcript: SessionTranscript;
  publish: (event: string, data: unknown) => number;
  model: () => string | null;
  currentTurn: () => TurnRecord | null;
}

export class SessionToolEvents {
  readonly liveChildAgents = new Map<string, string>();
  private readonly liveness = new TurnLivenessTracker();
  private readonly parents = new Map<string, string | null>();

  constructor(private readonly init: SessionToolEventsInit) {}

  get turnIsLive(): boolean {
    return this.liveness.turnIsLive;
  }

  beginTurn(): void {
    this.liveness.reset();
  }

  finishTurn(): void {
    this.parents.clear();
    this.liveness.reset();
  }

  started(event: Extract<AgentEvent, { kind: 'tool_call_started' }>): void {
    const parent = event.parentToolCallId;
    this.parents.set(event.toolCallId, parent);
    this.liveness.observe(event, parent === null);
    const input = summarizeToolInput(event.tool, event.input);
    const payload: Record<string, unknown> = {
      tool: event.tool,
      input,
      model: this.init.model(),
      tool_use_id: event.toolCallId,
    };
    if (parent) payload.parent_tool_use_id = parent;
    const id = this.init.publish('tool_call', payload);
    this.init.transcript.persistTool(
      {
        kind: 'tool_call',
        tool_use_id: event.toolCallId,
        tool: event.tool,
        input,
        is_subagent: parent !== null,
        parent_tool_use_id: parent,
        model: this.init.model(),
      },
      id,
    );
    this.trackSpawn(event, parent);
    const turn = this.init.currentTurn();
    if (turn && !turn.wroteLeanFiles && touchesLeanFile(event.tool, event.input)) turn.wroteLeanFiles = true;
  }

  completed(event: Extract<AgentEvent, { kind: 'tool_call_completed' }>): void {
    const parent = this.parents.get(event.toolCallId) ?? null;
    this.parents.delete(event.toolCallId);
    this.liveness.observe(event, parent === null);
    const summary = summarizeToolResult(event.result);
    const payload: Record<string, unknown> = {
      tool_use_id: event.toolCallId,
      result: event.isError ? summary : null,
      is_error: event.isError,
    };
    if (parent) payload.parent_tool_use_id = parent;
    const id = this.init.publish('tool_result', payload);
    this.init.transcript.persistTool(
      {
        kind: 'tool_result',
        tool_use_id: event.toolCallId,
        result: summary,
        is_error: event.isError,
        is_subagent: parent !== null,
        parent_tool_use_id: parent,
      },
      id,
    );
    const child = this.liveChildAgents.get(event.toolCallId);
    if (child !== undefined) this.agentStatus(event.toolCallId, child, event.isError ? 'failed' : 'completed');
  }

  /** Persists child lifecycle before publishing so reloads see the settled card. */
  agentStatus(toolCallId: string | null, agent: string, status: string): void {
    const payload: Record<string, unknown> = { agent, status };
    if (!toolCallId) {
      this.init.publish('agent_status', payload);
      return;
    }
    payload.tool_use_id = toolCallId;
    if (status === 'running') {
      if (!this.liveChildAgents.has(toolCallId)) this.liveChildAgents.set(toolCallId, agent);
    } else {
      this.liveChildAgents.delete(toolCallId);
    }
    this.init.transcript.persistTool({ kind: 'agent_status', ...payload }, null);
    this.init.transcript.advanceBoundary(this.init.publish('agent_status', payload));
  }

  flushLiveChildren(): void {
    for (const [toolUseId, agent] of [...this.liveChildAgents]) {
      this.agentStatus(toolUseId, agent, 'stopped');
    }
  }

  private trackSpawn(event: Extract<AgentEvent, { kind: 'tool_call_started' }>, parent: string | null): void {
    if ((event.tool !== 'Task' && event.tool !== 'Agent') || parent !== null) return;
    const agentType = typeof event.input.subagent_type === 'string' ? event.input.subagent_type : 'agent';
    this.liveChildAgents.set(event.toolCallId, agentType);
  }
}
