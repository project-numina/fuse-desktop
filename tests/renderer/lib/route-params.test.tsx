import type { PropsWithChildren } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { useFileParam } from '@/lib/route-params';

function readFileParam(initialEntry: string, routePath: string): string {
  const wrapper = ({ children }: PropsWithChildren) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePath} element={children} />
      </Routes>
    </MemoryRouter>
  );

  return renderHook(() => useFileParam(), { wrapper }).result.current;
}

describe('useFileParam', () => {
  it('reads and decodes a nested wildcard file path', () => {
    expect(readFileParam(
      '/repo/Mathlib%20Test/Topology%23Basics.lean',
      '/repo/*',
    )).toBe('Mathlib Test/Topology#Basics.lean');
  });

  it('returns an empty path at the wildcard route root', () => {
    expect(readFileParam('/repo', '/repo/*')).toBe('');
  });

  it('returns an empty path when the route has no wildcard parameter', () => {
    expect(readFileParam('/repo/numina', '/repo/:owner')).toBe('');
  });
});
