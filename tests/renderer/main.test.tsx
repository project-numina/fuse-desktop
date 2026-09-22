import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = vi.hoisted(() => ({ render: vi.fn() }));
const createRoot = vi.hoisted(() => vi.fn(() => root));
const App = vi.hoisted(() => vi.fn(() => null));

vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('@/App', () => ({ default: App }));

describe('renderer bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts the app in React strict mode', async () => {
    const container = document.getElementById('root');
    await import('@/main');

    expect(createRoot).toHaveBeenCalledWith(container);
    expect(root.render).toHaveBeenCalledOnce();
    const element = root.render.mock.calls[0][0] as React.ReactElement<{ children: React.ReactElement }>;
    expect(element.type).toBe(React.StrictMode);
    expect(element.props.children.type).toBe(App);
  });

  it('fails clearly when the HTML root is missing', async () => {
    document.body.innerHTML = '';
    await expect(import('@/main')).rejects.toThrow('Root element #root not found');
    expect(createRoot).not.toHaveBeenCalled();
  });
});
