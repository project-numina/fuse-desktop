import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useLeanCardPanel } from '@/features/blueprint/hooks/use-lean-card-panel';

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('useLeanCardPanel', () => {
  it('loads persisted state and clamps invalid widths', () => {
    localStorage.setItem('leanCardWidth', '700');
    localStorage.setItem('leanCardCollapsed', 'true');
    const { result } = renderHook(() => useLeanCardPanel());
    expect(result.current.leanCardWidth).toBe(560);
    expect(result.current.leanCardCollapsed).toBe(true);
  });

  it('uses defaults for missing, nonnumeric, and undersized widths', () => {
    localStorage.setItem('leanCardWidth', 'not-a-number');
    const { result } = renderHook(() => useLeanCardPanel());
    expect(result.current.leanCardWidth).toBe(320);
  });

  it('persists collapse changes after mount', () => {
    const { result } = renderHook(() => useLeanCardPanel());
    act(() => result.current.setLeanCardCollapsed(true));
    expect(localStorage.getItem('leanCardCollapsed')).toBe('true');
  });

  it('resizes from the right edge and clamps at maximum width', () => {
    const { result } = renderHook(() => useLeanCardPanel());
    act(() => result.current.onLeanResizeStart({
      clientX: 500, preventDefault() {},
    } as unknown as React.MouseEvent));
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 })));
    expect(result.current.leanCardWidth).toBe(560);
    act(() => window.dispatchEvent(new MouseEvent('mouseup')));
    expect(document.body.style.cursor).toBe('');
  });

  it('collapses after dragging beyond the grace threshold', () => {
    const { result } = renderHook(() => useLeanCardPanel());
    act(() => result.current.onLeanResizeStart({
      clientX: 500, preventDefault() {},
    } as unknown as React.MouseEvent));
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 750 })));
    expect(result.current.leanCardCollapsed).toBe(true);
    expect(document.body.style.cursor).toBe('');
  });

  it('cleans global drag styles on unmount', () => {
    const { result, unmount } = renderHook(() => useLeanCardPanel());
    act(() => result.current.onLeanResizeStart({
      clientX: 500, preventDefault() {},
    } as unknown as React.MouseEvent));
    unmount();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
