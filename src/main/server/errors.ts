/**
 * The error envelope the web backend produces, reproduced exactly so the
 * frontend's ApiError handling (status, detail, code, Retry-After) is unchanged:
 *   { "detail": "<string>", "code": "<string>", "request_id": "<string>" }
 */

import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { HttpError } from '../store/registry';

export { HttpError };

function safeDetail(status: number, detail: string): string {
  if (status === 403) return 'You do not have permission to access this resource.';
  if (status === 502) return 'An upstream service failed. Please try again.';
  if (status === 503) return 'The service is temporarily unavailable. Please try again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  return detail;
}

export function errorResponse(c: Context, error: unknown): Response {
  const requestId = randomUUID();
  if (error instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== null) headers['Retry-After'] = String(error.retryAfterSeconds);
    return c.json(
      { detail: safeDetail(error.status, error.detail), code: error.code ?? `http_${error.status}`, request_id: requestId },
      error.status as 400,
      headers,
    );
  }
  console.error(`[api] ${c.req.method} ${c.req.path} failed (${requestId}):`, error);
  return c.json(
    { detail: 'Something went wrong on our side. Please try again.', code: 'http_500', request_id: requestId },
    500,
  );
}

/** FastAPI-style 422 for malformed bodies. */
export function validationError(message = 'The request was invalid.'): HttpError {
  return new HttpError(422, message, 'validation_error');
}

export function notFound(detail = 'Not found'): HttpError {
  return new HttpError(404, detail, 'http_404');
}

export function conflict(detail: string): HttpError {
  return new HttpError(409, detail, 'http_409');
}
