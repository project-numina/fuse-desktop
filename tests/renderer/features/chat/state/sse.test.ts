import { describe, expect, it } from 'vitest';
import { objectPayload, parseSseEventData } from '@/features/chat/state/sse';

const event = (data: string): Event => ({ data }) as unknown as Event;

describe('chat SSE helpers', () => {
  it('parses JSON object event data', () => {
    expect(parseSseEventData(event('{"status":"running"}'))).toEqual({ status: 'running' });
  });
  it.each(['', '{bad', '[1,2]', '42', 'null'])('rejects non-object payload %j', (data) => {
    const result = parseSseEventData(event(data));
    expect(data === '' ? result : result).toEqual(data === '' ? {} : null);
  });
  it('passes through records and normalizes all other values', () => {
    const value = { a: 1 };
    expect(objectPayload(value)).toBe(value);
    expect(objectPayload(null)).toEqual({});
    expect(objectPayload([1])).toEqual({});
    expect(objectPayload('text')).toEqual({});
  });
});
