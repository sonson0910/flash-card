import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => logger);

import {
  classifyFunctionError,
  logFunctionEvent,
} from '../src/structuredLogger.js';

describe('structured Functions logger', () => {
  beforeEach(() => {
    logger.error.mockReset();
    logger.warn.mockReset();
  });

  it('emits only the allowlisted fallback schema with a bounded count', () => {
    logFunctionEvent({
      event: 'rate-limit-storage-fallback',
      outcome: 'activated',
      reason: 'firestore-quota',
      limit: 30,
    });

    expect(logger.warn).toHaveBeenCalledWith('function_event', {
      schemaVersion: 1,
      event: 'rate-limit-storage-fallback',
      outcome: 'activated',
      reason: 'firestore-quota',
      limit: 30,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    { event: 'unknown', outcome: 'failed', reason: 'raw-message' },
    {
      event: 'rate-limit-storage-fallback',
      outcome: 'activated',
      reason: 'firestore-quota',
      limit: Number.NaN,
    },
    {
      event: 'rate-limit-storage-fallback',
      outcome: 'activated',
      reason: 'firestore-quota',
      limit: 30,
      uid: 'private-user',
    },
    {
      event: 'legacy-library-migration',
      outcome: 'failed',
      reason: 'unexpected-error',
      errorClass: 'Database exploded with card content',
    },
  ])('drops malformed or privacy-unsafe fields', entry => {
    logFunctionEvent(entry);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('emits a stable error class without raw error details', () => {
    const error = Object.assign(new Error('private card content'), {
      code: 'permission-denied',
      stack: 'private stack',
    });

    logFunctionEvent({
      event: 'legacy-library-migration',
      outcome: 'failed',
      reason: 'unexpected-error',
      errorClass: classifyFunctionError(error),
    });

    expect(logger.error).toHaveBeenCalledWith('function_event', {
      schemaVersion: 1,
      event: 'legacy-library-migration',
      outcome: 'failed',
      reason: 'unexpected-error',
      errorClass: 'firestore-error',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private');
  });

  it('never changes application behavior when the logger fails', () => {
    logger.error.mockImplementation(() => {
      throw new Error('logger unavailable');
    });

    expect(() => logFunctionEvent({
      event: 'legacy-library-operator',
      outcome: 'failed',
      reason: 'unexpected-error',
      errorClass: 'unexpected-error',
    })).not.toThrow();
  });
});
