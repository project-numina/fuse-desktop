/**
 * How long an agent run has been going, and how that reads on a card.
 *
 * The one place a duration is turned into text, shared by every card that
 * shows one so a running agent and a finished one are never formatted by two
 * slightly different rules. Kept in `state/` rather than beside a component
 * because history hydration parses the backend's timestamps through the same
 * module.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Matches the trailing `Z` or `±HH:MM` offset of an ISO 8601 timestamp. */
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function padded(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Render an elapsed span as `45s`, `2m 14s`, or `1h 03m`.
 *
 * Seconds are dropped past an hour, where they are noise, and hours keep
 * counting past a day rather than growing another unit. A sub-second span
 * reads `0s`: the agent has run for a moment, which is not the same as having
 * no duration at all, a case that renders nothing and never reaches here.
 *
 * @param elapsedMs Elapsed milliseconds. Negative input is clamped to zero,
 *     which a clock that ticks slightly behind a just-stamped start can
 *     produce.
 * @return {string} The formatted duration.
 */
export function formatRunDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(
    0,
    Math.floor(elapsedMs / MILLISECONDS_PER_SECOND),
  );
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes}m ${padded(totalSeconds % SECONDS_PER_MINUTE)}s`;
  }

  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  return `${hours}h ${padded(totalMinutes % MINUTES_PER_HOUR)}m`;
}

/**
 * Read a persisted timestamp as epoch milliseconds.
 *
 * A timestamp without an offset is read as UTC rather than as local time,
 * which is what the browser would otherwise assume. That only matters for a
 * run still going, whose start is compared against the local clock: a
 * misread offset would show hours of elapsed time on an agent that just
 * started.
 *
 * @param value ISO timestamp from the history API, if any.
 * @return {number|undefined} Epoch milliseconds, or `undefined` when the
 *     value is missing or unparseable.
 */
export function parseRunTimestamp(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const normalized = TIMEZONE_SUFFIX.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}
