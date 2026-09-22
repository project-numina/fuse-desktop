import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { SseRoom, SseRooms } from '@main/server/sse';

interface Frame {
  event: string;
  data: unknown;
  id?: string;
}

function parseFrames(text: string): Frame[] {
  const frames: Frame[] = [];
  for (const raw of text.split('\n\n')) {
    if (!raw.trim()) continue;
    const frame: Frame = { event: 'message', data: '' };
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) frame.event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
      else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
    }
    frame.data = data ? JSON.parse(data) : '';
    frames.push(frame);
  }
  return frames;
}

/** Read the whole body, or give up after `timeoutMs` (returning what arrived and `ended: false`). */
async function drain(response: Response, timeoutMs: number): Promise<{ frames: Frame[]; ended: boolean }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let ended = false;
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        return;
      }
      text += decoder.decode(value, { stream: true });
    }
  })();
  await Promise.race([pump, deadline]);
  // Snapshot before cancelling: a cancel resolves the pending read as done.
  const result = { frames: parseFrames(text), ended };
  await reader.cancel().catch(() => undefined);
  return result;
}

function serve(room: SseRoom): Hono {
  const app = new Hono();
  app.get('/events', (c) => room.respond(c));
  return app;
}

describe('SseRoom.respond', () => {
  it('ends the stream when the room closes after a queue overflow', async () => {
    const room = new SseRoom('r', { overflowMessage: 'fell behind' });
    const app = serve(room);
    const response = await app.request('/events');
    expect(response.status).toBe(200);
    // Wait until the subscriber is attached, then burst past the queue limit
    // synchronously so the sentinel has to survive the discarded queue.
    for (let i = 0; i < 50 && room.subscriberCount === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(room.subscriberCount).toBe(1);
    for (let i = 0; i < 300; i += 1) room.publish('tick', { i });
    room.publish('session_end', { status: 'completed' });
    room.close();
    const { frames, ended } = await drain(response, 1500);
    expect(ended).toBe(true);
    const overflow = frames.find((frame) => frame.event === 'buffer_overflow');
    expect(overflow?.data).toEqual({ message: 'fell behind', recoverable: true });
    expect(frames.some((frame) => frame.event === 'heartbeat')).toBe(false);
  });

  it('ends the stream normally when the room closes without overflow', async () => {
    const room = new SseRoom('r');
    const app = serve(room);
    const response = await app.request('/events');
    for (let i = 0; i < 50 && room.subscriberCount === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    room.publish('a', { n: 1 });
    room.publish('session_end', {});
    room.close();
    const { frames, ended } = await drain(response, 1500);
    expect(ended).toBe(true);
    expect(frames.map((frame) => frame.event)).toEqual(['a', 'session_end']);
  });

  it('falls back to ?last_event_id when the Last-Event-ID header does not parse', async () => {
    const room = new SseRoom('r');
    for (let i = 1; i <= 5; i += 1) room.publish('n', { i });
    const app = serve(room);
    const fromQuery = await app.request('/events?last_event_id=3', { headers: { 'last-event-id': 'garbage' } });
    setTimeout(() => room.close(), 20);
    const replayed = await drain(fromQuery, 1000);
    expect(replayed.frames.map((frame) => frame.id)).toEqual(['4', '5']);

    const fresh = new SseRoom('s');
    for (let i = 1; i <= 5; i += 1) fresh.publish('n', { i });
    const fromHeader = await serve(fresh).request('/events?last_event_id=1', { headers: { 'last-event-id': '4' } });
    setTimeout(() => fresh.close(), 20);
    expect((await drain(fromHeader, 1000)).frames.map((frame) => frame.id)).toEqual(['5']);
  });
});

describe('SseRooms.closeAll', () => {
  it('closes every room and forgets it', () => {
    const rooms = new SseRooms(() => ({}));
    const a = rooms.get('a');
    const b = rooms.get('b');
    let sentinels = 0;
    a.subscribe((frame) => {
      if (frame === null) sentinels += 1;
    });
    b.subscribe((frame) => {
      if (frame === null) sentinels += 1;
    });
    rooms.closeAll();
    expect(sentinels).toBe(2);
    expect(a.isClosed).toBe(true);
    expect(rooms.peek('a')).toBeNull();
    expect(rooms.get('a')).not.toBe(a);
  });
});
