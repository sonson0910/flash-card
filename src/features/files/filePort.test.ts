import { describe, expect, it } from 'vitest';
import { FileError, toFileError } from './filePort';

const callableError = (code: string, reason?: string) => Object.assign(new Error(code), { code, details: reason ? { reason } : undefined });

describe('file service errors', () => {
  it('maps the service reasons before the transport codes', () => {
    expect(toFileError(callableError('functions/resource-exhausted', 'storage-quota')).kind).toBe('quota');
    expect(toFileError(callableError('functions/failed-precondition', 'file-too-large')).kind).toBe('size');
    expect(toFileError(callableError('functions/invalid-argument', 'file-type')).kind).toBe('type');
    expect(toFileError(callableError('functions/failed-precondition', 'account-profile-required')).kind).toBe('profile-required');
    expect(toFileError(callableError('functions/not-found', 'course-not-found')).kind).toBe('not-found');
  });

  it('maps storage and callable codes', () => {
    expect(toFileError(callableError('storage/canceled')).kind).toBe('canceled');
    expect(toFileError(callableError('storage/unauthorized')).kind).toBe('rejected');
    expect(toFileError(callableError('storage/quota-exceeded')).kind).toBe('quota');
    expect(toFileError(callableError('storage/retry-limit-exceeded')).kind).toBe('network');
    expect(toFileError(callableError('functions/resource-exhausted')).kind).toBe('rate-limited');
    expect(toFileError(callableError('functions/unavailable')).kind).toBe('network');
    expect(toFileError(new Error('something else')).kind).toBe('unavailable');
  });

  it('passes file errors through unchanged', () => {
    const error = new FileError('size');
    expect(toFileError(error)).toBe(error);
  });
});
