import { describe, expect, it } from 'vitest';
import { HttpError } from '@main/server/errors';
import { LEAN_PREPARING_DETAIL, leanPreparingError, leanServiceError } from '@main/services/lean/errors';
import { LSPRequestTimeout } from '@main/services/lean/lsp/errors';
import { LeanToolError } from '@main/services/lean/lsp/service';

describe('leanServiceError', () => {
  it('maps a build in progress to 409 lean_build_in_progress', () => {
    const error = leanServiceError(new LeanToolError('A full project build is in progress; Lean queries are paused until it finishes.'), 'lean_goal');
    expect(error).toMatchObject({ status: 409, code: 'lean_build_in_progress', detail: 'A project build is in progress. Lean queries resume when it finishes.' });
  });

  it('maps the missing requested file to 404 lean_file_not_found', () => {
    const missing = Object.assign(new Error("ENOENT: no such file or directory, open '/p/A.lean'"), { code: 'ENOENT', path: '/p/A.lean' });
    expect(leanServiceError(missing, 'lean_goal', '/p/A.lean')).toMatchObject({ status: 404, code: 'lean_file_not_found' });
    // A different missing file (toolchain, olean) stays a 502.
    expect(leanServiceError(missing, 'lean_goal', '/p/B.lean').status).toBe(502);
  });

  it('maps an out-of-range cursor to 400 lean_cursor_out_of_range', () => {
    expect(leanServiceError(new LeanToolError('Line 12 out of range (file has 3 lines)'), 'lean_goal')).toMatchObject({
      status: 400,
      code: 'lean_cursor_out_of_range',
      detail: 'The cursor position is outside the current file. Move the cursor and try again.',
    });
  });

  it('maps an LSP request timeout to 409 lean_query_retry with Retry-After 2', () => {
    const timeout = leanServiceError(new LSPRequestTimeout('$/lean/plainGoal', 4, 120_000), 'lean_goal');
    expect(timeout).toMatchObject({ status: 409, code: 'lean_query_retry', retryAfterSeconds: 2, detail: 'Lean is still processing this file. Please retry shortly.' });
    const textual = leanServiceError(new Error("LSP request 'textDocument/hover' (id 7) timed out after 0.5s"), 'lean_hover');
    expect(textual.code).toBe('lean_query_retry');
    expect(leanServiceError(new Error("prefix LSP request 'x' (id 1) timed out after 1s"), 'x').code).toBeNull();
  });

  it('falls back to a 502 and passes HttpErrors through', () => {
    expect(leanServiceError(new Error('boom'), 'lean_goal')).toMatchObject({ status: 502, detail: 'Lean language services are temporarily unavailable. Please try again.' });
    const passthrough = new HttpError(400, 'Invalid file path');
    expect(leanServiceError(passthrough, 'lean_goal')).toBe(passthrough);
    expect(leanPreparingError()).toMatchObject({ status: 409, detail: LEAN_PREPARING_DETAIL, code: 'lean_setup_required' });
  });
});
