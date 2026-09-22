import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation, useOutlet } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LightweightPageCache from '@/components/layout/LightweightPageCache';

describe('lightweight page cache', () => {
  it('restores local state, scroll, and disclosures; hidden pages detach effects', async () => {
    const cleanup = vi.fn();
    const setup = vi.fn();
    function Page() {
      const [count, setCount] = useState(0);
      useEffect(() => { setup(); return cleanup; }, []);
      return <div data-testid="page"><button onClick={() => setCount(count + 1)}>Count {count}</button><details><summary>Details</summary>Content</details></div>;
    }
    const view = render(<LightweightPageCache pageKey="a" page={<Page />} fallback={null} />);
    fireEvent.click(screen.getByText('Count 0'));
    const original = screen.getByTestId('page');
    original.scrollTop = 123;
    original.querySelector('details')!.open = true;
    view.rerender(<LightweightPageCache pageKey="b" page={<p>B</p>} fallback={null} />);
    expect(original).not.toBeVisible();
    expect(cleanup).toHaveBeenCalledOnce();
    view.rerender(<LightweightPageCache pageKey="a" page={<Page />} fallback={null} />);
    expect(screen.getByText('Count 1')).toBeVisible();
    expect(screen.getByTestId('page')).toBe(original);
    expect(original.scrollTop).toBe(123);
    expect(original.querySelector('details')!.open).toBe(true);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used page after three entries and never retains uncacheable pages', () => {
    const page = (key: string | null) => <LightweightPageCache pageKey={key} page={<p>{key ?? 'workspace'}</p>} fallback={null} />;
    const view = render(page('a'));
    for (const key of ['b', 'c', 'a', 'd']) view.rerender(page(key));
    expect(screen.queryByText('b')).not.toBeInTheDocument();
    expect(screen.getByText('a')).not.toBeVisible();
    expect(screen.getByText('d')).toBeVisible();
    view.rerender(page(null));
    expect(screen.getByText('workspace')).toBeVisible();
    view.rerender(page('d'));
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });

  it('works through real router outlets and back/forward history', async () => {
    function Layout() {
      const { pathname } = useLocation();
      const page = useOutlet();
      return <LightweightPageCache pageKey={pathname} page={page} fallback={null} />;
    }
    function Counter() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
    }
    const router = createMemoryRouter([{ element: <Layout />, children: [
      { path: '/a', element: <Counter /> }, { path: '/b', element: <p>B</p> },
    ] }], { initialEntries: ['/a'] });
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByText('Count 0'));
    await act(async () => { await router.navigate('/b'); });
    expect(screen.getByText('Count 1')).not.toBeVisible();
    await act(async () => { await router.navigate(-1); });
    expect(screen.getByText('Count 1')).toBeVisible();
    await act(async () => { await router.navigate(1); });
    expect(screen.getByText('B')).toBeVisible();
  });
});
