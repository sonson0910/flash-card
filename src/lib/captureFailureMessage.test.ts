import { describe, expect, it } from 'vitest';
import { OperationTimeoutError } from './async';
import { captureFailureMessage } from './captureFailureMessage';
import { ProtectedFunctionError, type ProtectedFunctionFailureKind } from './protectedFunctionsCapability';

const protectedFailure = (kind: ProtectedFunctionFailureKind, message = 'English provider error', retryAfterMs?: number) =>
  new ProtectedFunctionError({ message, kind, code: 'unavailable', retryable: false, retryAfterMs });

describe('capture failure guidance', () => {
  it.each([
    [protectedFailure('authentication'), /đăng nhập Google/],
    [protectedFailure('permission'), /Quyền truy cập AI/],
    [protectedFailure('quota'), /hết hạn mức/],
    [protectedFailure('network'), /Kết nối/],
    [protectedFailure('configuration'), /chưa sẵn sàng/],
    [protectedFailure('unknown'), /chưa tạo được thẻ/],
    [new OperationTimeoutError('English timeout'), /phản hồi quá lâu/],
    [new Error('English save failure'), /Chưa tạo hoặc lưu/],
  ])('shows Vietnamese next steps for %p', (error, expected) => {
    expect(captureFailureMessage(error)).toMatch(expected);
    expect(captureFailureMessage(error)).toMatch(/Từ đã chọn vẫn được giữ lại/);
  });

  it('preserves actionable quota and in-flight guidance', () => {
    expect(captureFailureMessage(protectedFailure('quota', 'Bạn đã dùng hết số thẻ AI kỳ này.')))
      .toContain('số thẻ AI');
    expect(captureFailureMessage(protectedFailure('network', 'Thẻ AI đang được tạo. Thử lại sau vài giây.', 5_000)))
      .toContain('Thử lại sau vài giây');
  });
});
