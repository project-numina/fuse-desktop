import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePanelResize } from '@/hooks/use-panel-resize';

describe('usePanelResize', () => {
  it('tracks drag distance and clamps the panel width', () => {
    const { result, unmount } = renderHook(() => usePanelResize(360));
    act(() => result.current.startResize(new MouseEvent('mousedown', { clientX: 100 })));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 })));
    expect(result.current.panelWidth).toBe(510);
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000 })));
    expect(result.current.panelWidth).toBe(640);
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: -1000 })));
    expect(result.current.panelWidth).toBe(240);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    unmount();
  });
});
