import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/core', () => ({ request }));

import {
  cancelSession,
  createSession,
  deleteSessionHistory,
  fetchActiveSessions,
  fetchLiveSessionForConversation,
  fetchNativeHistoryStatus,
  fetchRecentConversations,
  fetchSessionHistory,
  fetchSessionHistoryDetail,
  fetchSessionState,
  fetchSubagentHistory,
  keepaliveSession,
  respondPermissionRequest,
  reviewBackgroundSession,
  sendSessionMessage,
} from '@/lib/api/sessions';

describe('session API paths', () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it('serializes history filters with defaults and URL-encoded repository data', async () => {
    await fetchSessionHistory('Ada Lovelace', 'proofs/logic', 'Main & Aux');

    expect(request).toHaveBeenCalledWith(
      '/sessions/history?repository_owner=Ada+Lovelace'
      + '&repository_name=proofs%2Flogic&blueprint_name=Main+%26+Aux'
      + '&limit=20&offset=0&refresh_native=true',
    );
  });

  it('preserves explicit pagination edges and the native-refresh choice', async () => {
    await fetchSessionHistory('', '', '', 0, -1, false);
    await fetchRecentConversations(0, -1);

    expect(request.mock.calls).toEqual([
      [
        '/sessions/history?repository_owner=&repository_name=&blueprint_name='
        + '&limit=0&offset=-1&refresh_native=false',
      ],
      ['/sessions/history/recent?limit=0&offset=-1'],
    ]);
  });

  it('uses default pagination for recent conversations', async () => {
    await fetchRecentConversations();
    expect(request).toHaveBeenCalledWith('/sessions/history/recent?limit=20&offset=0');
  });

  it('serializes the native-history status query', async () => {
    await fetchNativeHistoryStatus('owner name', 'repo/name', 'Blueprint #1');
    expect(request).toHaveBeenCalledWith(
      '/sessions/history/native-status?repository_owner=owner+name'
      + '&repository_name=repo%2Fname&blueprint_name=Blueprint+%231',
    );
  });

  it('encodes every dynamic history path segment', async () => {
    await fetchSessionHistoryDetail('job /?#');
    await fetchSubagentHistory('conversation /?#', 'tool /?#');
    await fetchLiveSessionForConversation('live /?#');

    expect(request.mock.calls.map((call) => call[0])).toEqual([
      '/sessions/history/job%20%2F%3F%23',
      '/sessions/history/conversation%20%2F%3F%23/subagents/tool%20%2F%3F%23',
      '/sessions/history/live%20%2F%3F%23/live',
    ]);
  });

  it('fetches the active list and an encoded session state', async () => {
    await fetchActiveSessions();
    await fetchSessionState('session /?#');

    expect(request.mock.calls).toEqual([
      ['/sessions/active'],
      ['/sessions/session%20%2F%3F%23/state'],
    ]);
  });

  it('serializes a minimal create body without optional fields', async () => {
    const body = {
      repository_owner: 'numina',
      repository_name: 'fuse',
      blueprint_name: 'Proof',
      initial_message: 'Start',
    };

    await createSession(body);
    expect(request).toHaveBeenCalledWith('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  });

  it('preserves nulls and nested attachment selection data when creating', async () => {
    const body = {
      repository_owner: 'numina',
      repository_name: 'fuse',
      blueprint_name: 'Proof',
      initial_message: 'Use this source',
      resume_from_conversation_id: null,
      context_attachments: [{
        attachment_kind: 'backend_source' as const,
        source_id: null,
        artifact_kind: 'paper',
        selection: { kind: 'pages', pages: [1, 3], exact: true },
      }],
    };

    await createSession(body);
    expect(request).toHaveBeenCalledWith('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  });

  it('encodes the session ID and serializes follow-up attachments', async () => {
    const body = {
      content: 'Continue',
      context_attachments: [{
        attachment_kind: 'repo_file' as const,
        repo_path: 'Mathlib/Algebra.lean',
        selection: { kind: 'lines', start: 10, end: 20 },
      }],
    };

    await sendSessionMessage('session /?#', body);
    expect(request).toHaveBeenCalledWith(
      '/sessions/session%20%2F%3F%23/messages',
      { method: 'POST', body: JSON.stringify(body) },
    );
  });

  it('posts bodyless session lifecycle actions to encoded paths', async () => {
    await keepaliveSession('keep /?#');
    await reviewBackgroundSession('review /?#');
    await cancelSession('cancel /?#');

    expect(request.mock.calls).toEqual([
      ['/sessions/keep%20%2F%3F%23/keepalive', { method: 'POST' }],
      [
        '/sessions/history/review%20%2F%3F%23/review-background',
        { method: 'POST' },
      ],
      ['/sessions/cancel%20%2F%3F%23/cancel', { method: 'POST' }],
    ]);
  });

  it('serializes permission decisions without interpreting suggestion payloads', async () => {
    const decision = {
      behavior: 'deny' as const,
      suggestion: { mode: 'custom', rules: ['read', { tool: 'Bash' }] },
      message: 'Not in this directory',
    };

    await respondPermissionRequest('session /?#', 'request /?#', decision);
    expect(request).toHaveBeenCalledWith(
      '/sessions/session%20%2F%3F%23/permissions/request%20%2F%3F%23',
      { method: 'POST', body: JSON.stringify(decision) },
    );
  });

  it('deletes encoded history identifiers with DELETE', async () => {
    await deleteSessionHistory('job /?#');
    expect(request).toHaveBeenCalledWith('/sessions/history/job%20%2F%3F%23', {
      method: 'DELETE',
    });
  });

  it('returns the request promise and propagates network failures unchanged', async () => {
    const response = { sessions: [], active_count: 0, max_active_sessions: 4 };
    const pending = Promise.resolve(response);
    request.mockReturnValueOnce(pending);
    expect(fetchActiveSessions()).toBe(pending);
    await expect(pending).resolves.toBe(response);

    const failure = new TypeError('Failed to fetch');
    request.mockRejectedValueOnce(failure);
    await expect(fetchSessionState('offline')).rejects.toBe(failure);
  });
});
