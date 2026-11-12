import { describe, expect, it } from 'vitest';
import { BUILD_REQUEST_TIMEOUT_MS, CODEX_MCP_TOOL_TIMEOUT_SEC, LEAN_BUILD_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS, SESSION_ACTIVITY_TIMEOUT_MS } from '@shared/build-timeouts';

describe('build deadlines', () => {
  it('keeps both providers and the session alive until a six-hour build can return', () => {
    expect(LEAN_BUILD_TIMEOUT_MS).toBe(21_600_000);
    expect(BUILD_REQUEST_TIMEOUT_MS).toBe(21_900_000);
    expect(MCP_TOOL_TIMEOUT_MS).toBe(21_960_000);
    expect(CODEX_MCP_TOOL_TIMEOUT_SEC * 1000).toBe(MCP_TOOL_TIMEOUT_MS);
    expect(SESSION_ACTIVITY_TIMEOUT_MS).toBeGreaterThan(MCP_TOOL_TIMEOUT_MS);
  });
});
