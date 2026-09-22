import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const REQUEST_ID = '11111111-2222-4333-8444-555555555555';

vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomUUID: vi.fn(() => REQUEST_ID),
}));

import {
  HttpError,
  conflict,
  errorResponse,
  notFound,
  validationError,
} from '@main/server/errors';

function respond(error: unknown, path = '/resource'): Promise<Response> {
  const app = new Hono();
  app.get(path, (c) => errorResponse(c, error));
  return Promise.resolve(app.request(path));
}

describe('errorResponse', () => {
  it.each([
    [403, 'private detail', 'You do not have permission to access this resource.'],
    [502, 'gateway detail', 'An upstream service failed. Please try again.'],
    [503, 'outage detail', 'The service is temporarily unavailable. Please try again.'],
    [500, 'database detail', 'Something went wrong on our side. Please try again.'],
    [418, 'Short and stout', 'Short and stout'],
  ])('returns status %i with the normalized public detail', async (status, detail, expected) => {
    const response = await respond(new HttpError(status, detail));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      detail: expected,
      code: `http_${status}`,
      request_id: REQUEST_ID,
    });
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('preserves an explicit code and Retry-After value', async () => {
    const response = await respond(new HttpError(429, 'Slow down', 'rate_limited', 0));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('0');
    expect(await response.json()).toEqual({
      detail: 'Slow down',
      code: 'rate_limited',
      request_id: REQUEST_ID,
    });
  });

  it('logs unexpected failures and returns a generic 500 envelope', async () => {
    const failure = new TypeError('secret database failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await respond(failure, '/explode');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      detail: 'Something went wrong on our side. Please try again.',
      code: 'http_500',
      request_id: REQUEST_ID,
    });
    expect(consoleError).toHaveBeenCalledWith(
      `[api] GET /explode failed (${REQUEST_ID}):`,
      failure,
    );
  });
});

describe('HTTP error helpers', () => {
  it('constructs validation errors with default and custom details', () => {
    expect(validationError()).toMatchObject({
      status: 422,
      detail: 'The request was invalid.',
      code: 'validation_error',
    });
    expect(validationError('A field is missing')).toMatchObject({
      status: 422,
      detail: 'A field is missing',
      code: 'validation_error',
    });
  });

  it('constructs not-found errors with default and custom details', () => {
    expect(notFound()).toMatchObject({ status: 404, detail: 'Not found', code: 'http_404' });
    expect(notFound('Workspace not found')).toMatchObject({
      status: 404,
      detail: 'Workspace not found',
      code: 'http_404',
    });
  });

  it('constructs conflict errors', () => {
    expect(conflict('Already exists')).toMatchObject({
      status: 409,
      detail: 'Already exists',
      code: 'http_409',
    });
  });
});
