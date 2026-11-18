/** Preserve browser launch authentication across SPA navigation and reloads. */
const TOKEN_KEY = 'fuse_token';

function captureInitialToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = new URLSearchParams(window.location.search).get(TOKEN_KEY);
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_KEY, token);
      return token;
    }
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Storage may be disabled; the launch token still works for this page.
    return token;
  }
}

const initialToken = captureInitialToken();

/** Attach the local browser token only to this origin's API resources. */
export function authenticatedApiUrl(path: string): string {
  if (!initialToken || !path || typeof window === 'undefined') return path;
  let url: URL;
  try {
    url = new URL(path, window.location.href);
  } catch {
    return path;
  }
  if (url.origin !== window.location.origin
    || (url.protocol !== 'http:' && url.protocol !== 'https:')
    || (url.pathname !== '/api' && !url.pathname.startsWith('/api/'))) return path;
  url.searchParams.set(TOKEN_KEY, initialToken);
  return `${url.pathname}${url.search}${url.hash}`;
}
