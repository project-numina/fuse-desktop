import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAuth() {
  vi.resetModules();
  return import('@/lib/local-auth');
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('local browser authentication', () => {
  it('captures the launch token before navigation and restores it on reload', async () => {
    window.history.replaceState(null, '', '/?fuse_token=launch%2Btoken');
    const initial = await loadAuth();
    window.history.replaceState(null, '', '/repo/owner/repo');
    expect(initial.authenticatedApiUrl('/api/sessions?last_event_id=12#tail'))
      .toBe('/api/sessions?last_event_id=12&fuse_token=launch%2Btoken#tail');
    const reloaded = await loadAuth();
    expect(reloaded.authenticatedApiUrl('/api/sessions'))
      .toBe('/api/sessions?fuse_token=launch%2Btoken');
  });

  it('prefers a new launch token over a stored token without duplicating parameters', async () => {
    window.sessionStorage.setItem('fuse_token', 'old');
    window.history.replaceState(null, '', '/?fuse_token=new');
    const { authenticatedApiUrl } = await loadAuth();
    expect(authenticatedApiUrl('/api?fuse_token=old')).toBe('/api?fuse_token=new');
    expect(window.sessionStorage.getItem('fuse_token')).toBe('new');
  });

  it('authenticates same-origin absolute URLs and leaves other resources unchanged', async () => {
    window.history.replaceState(null, '', '/?fuse_token=secret');
    const { authenticatedApiUrl } = await loadAuth();
    expect(authenticatedApiUrl(`${window.location.origin}/api/files/image.png`))
      .toBe('/api/files/image.png?fuse_token=secret');
    for (const path of ['', '/assets/image.png', '/api-other', 'https://example.com/api/files', '//example.com/api/files', 'data:image/png;base64,abc', 'blob:http://localhost/id']) {
      expect(authenticatedApiUrl(path)).toBe(path);
    }
  });

  it('leaves desktop requests unchanged when no token was provided', async () => {
    const { authenticatedApiUrl } = await loadAuth();
    expect(authenticatedApiUrl('/api/sessions?x=1')).toBe('/api/sessions?x=1');
  });

  it('uses the launch token even when session storage is unavailable', async () => {
    window.history.replaceState(null, '', '/?fuse_token=secret');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    const { authenticatedApiUrl } = await loadAuth();
    expect(authenticatedApiUrl('/api/sessions')).toBe('/api/sessions?fuse_token=secret');
  });
});
