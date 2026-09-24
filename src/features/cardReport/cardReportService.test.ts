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

describe('reportCardFailureMessage', () => {
  const protectedError = (kind: ProtectedFunctionError['kind'], code: string) =>
    new ProtectedFunctionError({ message: 'internal detail', kind, code, retryable: false });

  it('gives a distinct message for each classified failure kind', () => {
    expect(reportCardFailureMessage(protectedError('authentication', 'unauthenticated')))
      .toBe('Bạn cần đăng nhập để báo cáo thẻ. Hãy đăng nhập rồi thử lại.');
    expect(reportCardFailureMessage(protectedError('permission', 'permission-denied')))
      .toBe('Không có quyền báo cáo thẻ này. Hãy đăng nhập lại rồi thử.');
    expect(reportCardFailureMessage(protectedError('quota', 'resource-exhausted')))
      .toBe('Bạn đã báo cáo quá nhiều lần trong thời gian ngắn. Hãy thử lại sau.');
    expect(reportCardFailureMessage(protectedError('network', 'unavailable')))
      .toBe('Không kết nối được máy chủ báo cáo. Hãy kiểm tra mạng rồi thử lại.');
    expect(reportCardFailureMessage(protectedError('configuration', 'failed-precondition')))
      .toBe('Dịch vụ báo cáo thẻ chưa sẵn sàng. Hãy thử lại sau.');
    expect(reportCardFailureMessage(protectedError('unknown', 'unknown')))
      .toBe('Không gửi được báo cáo. Hãy thử lại hoặc liên hệ hỗ trợ.');
  });

  it('gives a specific message when the card no longer exists', () => {
    expect(reportCardFailureMessage(protectedError('configuration', 'not-found')))
      .toBe('Không tìm thấy thẻ để báo cáo. Thẻ có thể đã bị xóa.');
  });

  it('surfaces a client-side validation message as-is', () => {
    expect(reportCardFailureMessage(new Error('Ghi chú tối đa 280 ký tự.'))).toBe('Ghi chú tối đa 280 ký tự.');
  });

  it('falls back to a generic connection message for an unrecognized failure', () => {
    expect(reportCardFailureMessage('not an error')).toBe('Không gửi được báo cáo. Hãy kiểm tra kết nối rồi thử lại.');
  });
});
