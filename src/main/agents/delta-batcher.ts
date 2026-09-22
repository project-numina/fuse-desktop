import type { AgentEvent } from '@shared/agent-events';

/**
 * Coalesces streamed text/thinking deltas so the renderer receives a few
 * IPC messages per frame instead of one per token. Every other event flushes
 * the pending deltas first, so ordering is preserved exactly.
 */
export class DeltaBatcher {
  private pending = new Map<string, Extract<AgentEvent, { kind: 'assistant_text_delta' | 'thinking_delta' }>>();
  private order: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sink: (event: AgentEvent) => void,
    private readonly intervalMs = 32,
  ) {}

  push(event: AgentEvent): void {
    if (event.kind === 'assistant_text_delta' || event.kind === 'thinking_delta') {
      const key = `${event.kind}:${event.turnId}:${event.blockId}`;
      const existing = this.pending.get(key);
      if (existing) {
        existing.text += event.text;
        existing.at = event.at;
      } else {
        this.pending.set(key, { ...event });
        this.order.push(key);
      }
      if (!this.timer) this.timer = setTimeout(() => this.flush(), this.intervalMs);
      return;
    }
    this.flush();
    this.sink(event);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.order.length === 0) return;
    const keys = this.order;
    const pending = this.pending;
    this.order = [];
    this.pending = new Map();
    for (const key of keys) {
      const event = pending.get(key);
      if (event) this.sink(event);
    }
  }
}
