import { HttpError } from '../../server/errors';

function isErrno(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code);
}

/** Preserve edit errors while translating raw filesystem failures for HTTP callers. */
export function editServiceError(error: unknown, failureDetail: string): HttpError {
  if (error instanceof HttpError) return error;
  if (isErrno(error)) {
    console.error(`[blueprints] ${failureDetail}`, error);
    return new HttpError(500, failureDetail, 'http_500');
  }
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  let status = 409;
  if (lowered.includes('not found')) status = 404;
  else if (lowered.includes('invalid') || lowered.includes('not part')) status = 400;
  return new HttpError(status, message, `http_${status}`);
}
