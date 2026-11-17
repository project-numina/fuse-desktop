/** A build may run for six hours; outer waits allow time to return its result. */
export const LEAN_BUILD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
export const BUILD_REQUEST_TIMEOUT_MS = LEAN_BUILD_TIMEOUT_MS + 5 * 60 * 1000;
export const MCP_TOOL_TIMEOUT_MS = BUILD_REQUEST_TIMEOUT_MS + 60 * 1000;
export const CODEX_MCP_TOOL_TIMEOUT_SEC = Math.ceil(MCP_TOOL_TIMEOUT_MS / 1000);
export const SESSION_ACTIVITY_TIMEOUT_MS = MCP_TOOL_TIMEOUT_MS + 60 * 1000;
