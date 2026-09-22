import { describe, expect, it } from 'vitest';

import { makeBackoff, parseSseEventData } from '@/lib/sse';

describe('SSE primitives', () => {
  it('accepts object payloads and rejects malformed or non-object data', () => {
    expect(parseSseEventData(new MessageEvent('x', { data: '{"phase":"done"}' }))).toEqual({ phase: 'done' });
    expect(parseSseEventData(new MessageEvent('x', { data: '' }))).toEqual({});
    expect(parseSseEventData(new MessageEvent('x', { data: '[' }))).toBeNull();
    expect(parseSseEventData(new MessageEvent('x', { data: '[]' }))).toBeNull();
    expect(parseSseEventData(new MessageEvent('x', { data: 'null' }))).toBeNull();
  });

  it('caps and resets exponential backoff', () => {
    const backoff = makeBackoff({ initialMs: 100, maxMs: 350, factor: 2 });
    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([100, 200, 350, 350]);
    backoff.reset();
    expect(backoff.peek()).toBe(100);
  });
});
