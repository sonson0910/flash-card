import { i18n } from '@lingui/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

i18n.load('en', {});
i18n.activate('en');

const runtime = vi.hoisted(() => ({
  app: { name: 'test-app' },
  capability: { available: true } as { available: boolean; reason?: string },
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: runtime.getFunctions,
  httpsCallable: runtime.httpsCallable,
}));

vi.mock('../../lib/firebase', () => ({
  app: runtime.app,
  protectedFunctionsCapability: runtime.capability,
}));

import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { reportCardFailureMessage, submitCardReport } from './cardReportService';

describe('cardReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.capability.available = true;
    delete runtime.capability.reason;
    runtime.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    runtime.httpsCallable.mockReturnValue(runtime.callable);
    runtime.callable.mockResolvedValue({ data: { reportId: 'report-1', status: 'open' } });
  });

  it('submits a bounded report to the protected callable', async () => {
    await submitCardReport({ cardId: 'word-focus', reason: 'wrong-meaning', note: '  Nghĩa sai.  ' });
    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'reportCard');
    expect(runtime.callable).toHaveBeenCalledWith({
      cardId: 'word-focus',
      reason: 'wrong-meaning',
      note: 'Nghĩa sai.',
    });
  });

  it('rejects invalid reports before calling the backend', async () => {
    await expect(submitCardReport({ cardId: '../card', reason: 'other' })).rejects.toThrow(/invalid/i);
    await expect(submitCardReport({ cardId: 'card', reason: 'other', note: 'x'.repeat(281) })).rejects.toThrow(/280/i);
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });

  it('blocks submission if protected functions are unavailable', async () => {
    runtime.capability.available = false;
    runtime.capability.reason = 'app-check-initialization-failed';
    await expect(submitCardReport({ cardId: 'card', reason: 'other' })).rejects.toThrow();
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });
});

describe('reportCardFailureMessage', () => {
  const protectedError = (kind: ProtectedFunctionError['kind'], code: string) =>
    new ProtectedFunctionError({ message: 'internal detail', kind, code, retryable: false });

  it('gives a distinct message for each classified failure kind', () => {
    expect(reportCardFailureMessage(protectedError('authentication', 'unauthenticated')))
      .toBe('You need to sign in to report a card. Please sign in and try again.');
    expect(reportCardFailureMessage(protectedError('permission', 'permission-denied')))
      .toBe("You don't have permission to report this card. Please sign in again and try.");
    expect(reportCardFailureMessage(protectedError('quota', 'resource-exhausted')))
      .toBe("You've reported too many times in a short period. Please try again later.");
    expect(reportCardFailureMessage(protectedError('network', 'unavailable')))
      .toBe("Couldn't reach the report server. Please check your connection and try again.");
    expect(reportCardFailureMessage(protectedError('configuration', 'failed-precondition')))
      .toBe('The card reporting service is not ready yet. Please try again later.');
    expect(reportCardFailureMessage(protectedError('unknown', 'unknown')))
      .toBe("Couldn't send the report. Please try again or contact support.");
  });

  it('gives a specific message when the card no longer exists', () => {
    expect(reportCardFailureMessage(protectedError('configuration', 'not-found')))
      .toBe('Card not found to report. It may have been deleted.');
  });

  it('surfaces a client-side validation message as-is', () => {
    expect(reportCardFailureMessage(new Error('The note can be at most 280 characters.')))
      .toBe('The note can be at most 280 characters.');
  });

  it('falls back to a generic connection message for an unrecognized failure', () => {
    expect(reportCardFailureMessage('not an error')).toBe("Couldn't send the report. Please check your connection and try again.");
  });
});
