import { memo } from 'react';

import { useRunClock } from '@/features/chat/hooks/use-run-clock';
import { formatRunDuration } from '@/features/chat/state/run-duration';

/**
 * How long an agent has been going, shown beside its call count.
 *
 * Its own component rather than a string on the card so a ticking duration
 * re-renders one leaf a second instead of the whole card, and so the cards
 * that show one agree on when a duration is worth showing at all: an unknown
 * span renders nothing, because a card claiming `0s` for a run whose start was
 * never recorded is worse than a card that stays quiet.
 */

interface RunDurationProps {
  /** Epoch milliseconds the run started, if known. */
  startedAt?: number;
  /** Epoch milliseconds the run settled, if it has and the time is known. */
  endedAt?: number;
  /** Whether the run is still going, and so still counts up. */
  running: boolean;
}

export const RunDuration = memo(function RunDuration({
  startedAt,
  endedAt,
  running,
}: RunDurationProps) {
  // Subscribed before any early return: a card that settles mid-life stops
  // ticking by re-rendering with `running` false, not by skipping the hook.
  const now = useRunClock(running && startedAt !== undefined);
  if (startedAt === undefined) return null;
  // A settled run with no recorded end is a session that died before saying so.
  // Its start is known but its duration is not, so nothing is shown.
  const finishedAt = running ? now : endedAt;
  if (finishedAt === undefined) return null;

  return (
    <span className="run-duration">{formatRunDuration(finishedAt - startedAt)}</span>
  );
});

export default RunDuration;
