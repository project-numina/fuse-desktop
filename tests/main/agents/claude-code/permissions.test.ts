import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/agent-events';
import { ClaudePermissionController, permissionSuggestions } from '@main/agents/claude-code/permissions';

describe('ClaudePermissionController', () => {
  it('correlates an allow decision and forwards a persistent suggestion', () => {
    const events: AgentEvent[] = [];
    const write = vi.fn();
    const permissions = new ClaudePermissionController((event) => events.push(event), write);
    const suggestion = { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Read' }] };

    permissions.handleRequest({
      request_id: 'request-1',
      request: { subtype: 'can_use_tool', tool_name: 'Read', input: { path: '/tmp/a' } },
    }, 'turn-1');
    expect(permissions.respond('request-1', { behavior: 'allow', suggestion })).toBe(true);

    expect(write).toHaveBeenLastCalledWith({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'request-1',
        response: { behavior: 'allow', updatedInput: { path: '/tmp/a' }, updatedPermissions: [suggestion] },
      },
    });
    expect(events.map((event) => event.kind)).toEqual(['permission_request', 'permission_resolved']);
  });

  it('acknowledges unknown controls and denies a tool prompt without a turn', () => {
    const write = vi.fn();
    const permissions = new ClaudePermissionController(vi.fn(), write);

    permissions.handleRequest({ request_id: 'unknown', request: { subtype: 'future_control' } }, 'turn-1');
    permissions.handleRequest({ request_id: 'inactive', request: { subtype: 'can_use_tool' } }, null);

    expect(write.mock.calls[0][0]).toMatchObject({ response: { request_id: 'unknown', response: {} } });
    expect(write.mock.calls[1][0]).toMatchObject({
      response: { request_id: 'inactive', response: { behavior: 'deny', message: 'No active turn.' } },
    });
  });

  it('labels only supported allow-rule suggestions', () => {
    expect(permissionSuggestions([
      { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash', ruleContent: 'lake *' }] },
      { type: 'addRules', behavior: 'deny', rules: [{ toolName: 'Read' }] },
    ])).toEqual([
      expect.objectContaining({ label: 'Allow Bash(lake *) for this session' }),
    ]);
  });
});
