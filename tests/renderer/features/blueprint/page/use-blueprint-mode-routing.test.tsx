import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: { mode: 'graph' },
  location: { pathname: '/workspace/graph', search: '?chat=1', hash: '#old' },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useLocation: () => mocks.location,
}));
vi.mock('@/features/blueprint/lib/blueprint-helpers', () => ({
  URL_TO_MODE: { graph: 'graph', edit: 'edit' },
  blueprintModeUrl: (base: string, mode: string, search: string) => `${base}/${mode}${search}`,
}));

import { useBlueprintModeRouting } from '@/features/blueprint/page/use-blueprint-mode-routing';

it('tracks mounted modes and delegates route/hash navigation', () => {
  const { result } = renderHook(() => useBlueprintModeRouting({
    owner: 'acme', repo: 'mathlib', blueprintId: 'fermat',
  }));

  expect(result.current.mode).toBe('graph');
  expect(result.current.mountedModes).toEqual(new Set(['home', 'graph']));
  act(() => result.current.handleModeChange('edit'));
  expect(mocks.navigate).toHaveBeenCalledWith(
    '/repo/acme/mathlib/blueprint/fermat/edit?chat=1',
  );
  act(() => result.current.navigateHash('lemma-1', true));
  expect(mocks.navigate).toHaveBeenLastCalledWith({
    pathname: '/workspace/graph', search: '?chat=1', hash: '#lemma-1',
  }, { replace: true });
});
