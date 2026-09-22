import { describe, expect, it } from 'vitest';
import { formatRunDuration, parseRunTimestamp } from '@/features/chat/state/run-duration';

describe('formatRunDuration', () => {
  it.each([
    [0, '0s'],
    [1, '0s'],
    [999, '0s'],
    [1_000, '1s'],
    [45_000, '45s'],
    [59_999, '59s'],
    [60_000, '1m 00s'],
    [134_000, '2m 14s'],
    [124_000, '2m 04s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 00m'],
    [3_780_000, '1h 03m'],
    [93_600_000, '26h 00m'],
  ])('renders %ims as %s', (elapsed, expected) => {
    expect(formatRunDuration(elapsed)).toBe(expected);
  });

  it('reads a sub-second run as a moment, never as nothing', () => {
    expect(formatRunDuration(120)).toBe('0s');
  });

  it('clamps a clock that reads behind the start it is measured from', () => {
    expect(formatRunDuration(-4_000)).toBe('0s');
  });
});

describe('parseRunTimestamp', () => {
  const noon = Date.UTC(2026, 7, 31, 12, 0, 0);

  it.each([
    [undefined],
    [null],
    [''],
    ['not a timestamp'],
  ])('has no reading for %s', (value) => {
    expect(parseRunTimestamp(value)).toBeUndefined();
  });

  it('reads a timestamp without an offset as UTC, not as local time', () => {
    expect(parseRunTimestamp('2026-08-31T12:00:00')).toBe(noon);
    expect(parseRunTimestamp('2026-08-31T12:00:00.500000')).toBe(noon + 500);
  });

  it('honours an offset the backend did send', () => {
    expect(parseRunTimestamp('2026-08-31T12:00:00Z')).toBe(noon);
    expect(parseRunTimestamp('2026-08-31T12:00:00+00:00')).toBe(noon);
    expect(parseRunTimestamp('2026-08-31T14:00:00+02:00')).toBe(noon);
  });
});
