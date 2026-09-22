import { describe, expect, it } from 'vitest';

import { createSelectionTracker } from '@/features/blueprint/hooks/infoview/selection';

describe('infoview selection tracker', () => {
  it('invalidates captured work after a file change', () => {
    const filePathRef = { current: 'A.lean' as string | null };
    const tracker = createSelectionTracker(filePathRef);
    const selection = tracker.capture();

    expect(selection?.isCurrent()).toBe(true);
    filePathRef.current = 'B.lean';
    expect(selection?.isCurrent()).toBe(false);
    expect(tracker.capture()?.filePath).toBe('B.lean');
  });

  it('invalidates all work when disposed', () => {
    const tracker = createSelectionTracker({ current: 'A.lean' });
    const selection = tracker.capture();

    tracker.dispose();
    expect(selection?.isCurrent()).toBe(false);
    expect(tracker.capture()).toBeNull();
  });
});
