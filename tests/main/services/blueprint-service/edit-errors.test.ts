import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '@main/server/errors';
import { editServiceError } from '@main/services/blueprint-service/edit-errors';

describe('editServiceError', () => {
  it('preserves HttpErrors and maps edit messages to the established statuses', () => {
    const existing = new HttpError(422, 'No declarations', 'http_422');
    expect(editServiceError(existing, 'failed')).toBe(existing);
    expect(editServiceError(new Error('Chapter not found'), 'failed')).toMatchObject({ status: 404 });
    expect(editServiceError(new Error('Invalid chapter path'), 'failed')).toMatchObject({ status: 400 });
    expect(editServiceError(new Error('Conflicting content'), 'failed')).toMatchObject({ status: 409 });
  });

  it('hides errno details behind the stable 500 response', () => {
    const error = Object.assign(new Error('secret path'), { code: 'EACCES' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(editServiceError(error, 'Failed to save chapter edit.')).toMatchObject({
      status: 500,
      detail: 'Failed to save chapter edit.',
    });
    spy.mockRestore();
  });
});
