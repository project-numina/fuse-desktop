/**
 * Mapping Lean service failures onto the HTTP errors the frontend keys on.
 * The codes are load-bearing: `lean_query_retry` (with `Retry-After: 2`)
 * makes the Infoview retry once, `lean_build_in_progress`,
 * `lean_file_not_found` and `lean_cursor_out_of_range` pick its copy.
 */

import { HttpError } from '../../server/errors';
import { LSPRequestTimeout } from './lsp/errors';
import { leanFileNotFoundError } from './paths';

const BUILD_IN_PROGRESS_MARKER = 'build is in progress';
const CURSOR_OUT_OF_RANGE_PATTERN = /\bLine -?\d+ out of range \(file has \d+ lines\)/;
const LSP_QUERY_TIMEOUT_PATTERN = /^LSP request\s+'[^'\r\n]+'\s+\(id\s+\d+\)\s+timed out after\s+\d+(?:\.\d+)?s$/;

export const LEAN_PREPARING_DETAIL = 'Set up Lean to enable proof goals, hover information, and live checking. Choose “Set up Lean” to review disk space and start setup. You can keep browsing and editing without it.';
export const LEAN_UNAVAILABLE_DETAIL = 'Lean language services are temporarily unavailable. Please try again.';

export function leanPreparingError(): HttpError {
  return new HttpError(409, LEAN_PREPARING_DETAIL, 'lean_setup_required');
}

function missingPathMatches(error: unknown, expectedPath: string | undefined): boolean {
  if (!expectedPath) return false;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const path = (error as NodeJS.ErrnoException | null)?.path;
  return code === 'ENOENT' && typeof path === 'string' && path === expectedPath;
}

/** Log a Lean language-service failure and return the sanitized HTTP error. */
export function leanServiceError(error: unknown, action: string, requestedFilePath?: string): HttpError {
  if (error instanceof HttpError) return error;
  const text = error instanceof Error ? error.message : String(error);
  console.warn(`[lean] ${action} failed: ${text}`);
  if (text.includes(BUILD_IN_PROGRESS_MARKER)) {
    return new HttpError(409, 'A project build is in progress. Lean queries resume when it finishes.', 'lean_build_in_progress');
  }
  if (missingPathMatches(error, requestedFilePath)) return leanFileNotFoundError();
  if (CURSOR_OUT_OF_RANGE_PATTERN.test(text)) {
    return new HttpError(400, 'The cursor position is outside the current file. Move the cursor and try again.', 'lean_cursor_out_of_range');
  }
  if (error instanceof LSPRequestTimeout || LSP_QUERY_TIMEOUT_PATTERN.test(text.trim())) {
    return new HttpError(409, 'Lean is still processing this file. Please retry shortly.', 'lean_query_retry', 2);
  }
  return new HttpError(502, LEAN_UNAVAILABLE_DETAIL);
}
