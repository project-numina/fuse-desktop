/**
 * Server-sent event rooms with the web backend's semantics: every published
 * event gets a monotonically increasing integer id, a ring buffer of 1000
 * events allows replay from `Last-Event-ID` / `?last_event_id`, snapshot
 * frames carry no id, a heartbeat goes out every 15 s, and a subscriber
 * that falls behind receives `buffer_overflow`.
 */

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_BUFFER_SIZE = 1000;
const SUBSCRIBER_QUEUE_LIMIT = 256;

export interface SseFrame {
  event: string;
  data: unknown;
  /** Absent for snapshot frames. */
  id?: number;
}

type Listener = (frame: SseFrame | null) => void;

export interface RoomOptions {
  /** Frames sent to every new subscriber before replay (no ids). */
  snapshot?: () => SseFrame[];
  /** Called on each heartbeat tick while at least one subscriber is attached. */
  onHeartbeat?: (room: SseRoom) => void;
  /** Overflow message for a subscriber whose cursor was evicted. */
  overflowMessage?: string;
}

export class SseRoom {
  private counter = 0;
  private readonly buffer: SseFrame[] = [];
  private readonly listeners = new Set<Listener>();
  private closed = false;

  constructor(
    readonly key: string,
    private readonly options: RoomOptions = {},
  ) {}

  get eventCounter(): number {
    return this.counter;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  /** Publish an event with an id; returns the id. */
  publish(event: string, data: unknown): number {
    this.counter += 1;
    const frame: SseFrame = { event, data, id: this.counter };
    this.buffer.push(frame);
    if (this.buffer.length > SSE_BUFFER_SIZE) this.buffer.shift();
    for (const listener of this.listeners) listener(frame);
    return this.counter;
  }

  /** Send an id-less frame to current subscribers only (not buffered). */
  broadcastSnapshot(event: string, data: unknown): void {
    for (const listener of this.listeners) listener({ event, data });
  }

  /** Close every subscriber's stream after the last frame. */
  close(): void {
    this.closed = true;
    for (const listener of this.listeners) listener(null);
    this.listeners.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Frames to replay for a subscriber resuming after `cursor`; null when evicted. */
  replayAfter(cursor: number | null): SseFrame[] | null {
    if (cursor === null) return this.buffer.slice();
    const first = this.buffer[0];
    if (first && first.id !== undefined && first.id > cursor + 1) return null;
    return this.buffer.filter((frame) => frame.id !== undefined && frame.id > cursor);
  }

  /** Serve this room as an SSE response for the current request. */
  respond(c: Context, filterReplay?: (frame: SseFrame) => boolean): Response {
    // The header wins when it parses; otherwise the query may still carry a
    // usable cursor (the web falls back the same way).
    const cursor = parseCursor(c.req.header('last-event-id')) ?? parseCursor(c.req.query('last_event_id'));
    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache');
    return streamSSE(c, async (stream) => {
      const queue: Array<SseFrame | null> = [];
      let wake: (() => void) | null = null;
      let overflowed = false;
      // Set when the room closes; survives the queue being discarded on overflow.
      let closed = false;
      const push = (frame: SseFrame | null): void => {
        if (frame === null) closed = true;
        if (queue.length >= SUBSCRIBER_QUEUE_LIMIT && frame !== null) {
          overflowed = true;
          wake?.();
          return;
        }
        queue.push(frame);
        wake?.();
      };
      const unsubscribe = this.subscribe(push);
      stream.onAbort(() => wake?.());
      const waitForFrame = (): Promise<boolean> =>
        new Promise((resolve) => {
          if (queue.length > 0 || overflowed) {
            resolve(true);
            return;
          }
          const timer = setTimeout(() => {
            wake = null;
            resolve(false);
          }, SSE_HEARTBEAT_MS);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve(true);
          };
        });
      const write = async (frame: SseFrame): Promise<void> => {
        await stream.writeSSE({
          event: frame.event,
          data: frame.data === '' || frame.data === undefined ? '' : JSON.stringify(frame.data),
          ...(frame.id !== undefined ? { id: String(frame.id) } : {}),
        });
      };
      const overflow = (recoverable: boolean): SseFrame => ({
        event: 'buffer_overflow',
        data: { message: this.options.overflowMessage ?? 'Event stream fell behind. Reconnect to refresh.', recoverable },
      });
      try {
        for (const frame of this.options.snapshot?.() ?? []) await write(frame);
        const replay = this.replayAfter(cursor);
        if (replay === null) {
          await write(overflow(false));
        } else {
          for (const frame of replay) {
            if (!filterReplay || filterReplay(frame)) await write(frame);
          }
        }
        if (this.closed) return;
        while (!stream.aborted) {
          const ready = await waitForFrame();
          if (stream.aborted) break;
          if (!ready) {
            this.options.onHeartbeat?.(this);
            await stream.writeSSE({ event: 'heartbeat', data: '' });
            continue;
          }
          if (overflowed) {
            overflowed = false;
            queue.length = 0;
            await write(overflow(true));
            // The discarded queue may have held the end-of-stream sentinel.
            if (closed) break;
            continue;
          }
          const frame = queue.shift();
          if (frame === undefined) continue;
          if (frame === null) break;
          await write(frame);
        }
      } finally {
        unsubscribe();
      }
    });
  }
}

function parseCursor(raw: string | undefined): number | null {
  return raw !== undefined && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : null;
}

/** Rooms keyed by an arbitrary string, created on demand. */
export class SseRooms {
  private readonly rooms = new Map<string, SseRoom>();

  constructor(private readonly options: (key: string) => RoomOptions) {}

  get(key: string): SseRoom {
    let room = this.rooms.get(key);
    if (!room || room.isClosed) {
      room = new SseRoom(key, this.options(key));
      this.rooms.set(key, room);
    }
    return room;
  }

  peek(key: string): SseRoom | null {
    return this.rooms.get(key) ?? null;
  }

  delete(key: string): void {
    this.rooms.get(key)?.close();
    this.rooms.delete(key);
  }

  /** End every subscriber's stream (server shutdown). */
  closeAll(): void {
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
  }
}
