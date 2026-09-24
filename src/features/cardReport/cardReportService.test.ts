import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { submitCardReport } from './cardReportService';

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
    await expect(submitCardReport({ cardId: '../card', reason: 'other' })).rejects.toThrow(/không hợp lệ/i);
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
