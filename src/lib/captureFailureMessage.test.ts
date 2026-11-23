import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OperationTimeoutError } from './async';
import { CAPTURE_FAILURE_REASONS, captureFailureMessage, captureFailureReason } from './captureFailureMessage';
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

  it('shows the wait of an hourly limit instead of the plan quota text', () => {
    const error = new ProtectedFunctionError({
      message: 'Bạn đã gửi quá nhiều yêu cầu trong một giờ. Hãy thử lại sau khoảng 20 phút.',
      kind: 'quota', code: 'resource-exhausted', retryable: false, reason: 'rate-limit',
    });
    expect(captureFailureMessage(error)).toContain('khoảng 20 phút');
    expect(captureFailureMessage(error)).not.toContain('hết hạn mức');
    expect(captureFailureReason(error)).toBe('failed');
  });

  it('preserves actionable quota and in-flight guidance', () => {
    expect(captureFailureMessage(protectedFailure('quota', 'Bạn đã dùng hết số thẻ AI kỳ này.')))
      .toContain('số thẻ AI');
    expect(captureFailureMessage(protectedFailure('network', 'Thẻ AI đang được tạo. Thử lại sau vài giây.', 5_000)))
      .toContain('Thử lại sau vài giây');
  });

  it('names a bounded reason for every failure kind, including a generation that is still running', () => {
    expect(captureFailureReason(protectedFailure('authentication'))).toBe('auth');
    expect(captureFailureReason(protectedFailure('quota'))).toBe('quota');
    expect(captureFailureReason(new OperationTimeoutError('English timeout'))).toBe('timeout');
    expect(captureFailureReason(new Error('English save failure'))).toBe('failed');
    expect(captureFailureReason(protectedFailure('network', 'Thẻ AI đang được tạo.', 5_000))).toBe('in-flight');
    for (const kind of ['authentication', 'permission', 'quota', 'network', 'configuration', 'unknown'] as const) {
      expect(CAPTURE_FAILURE_REASONS).toContain(captureFailureReason(protectedFailure(kind)));
    }
  });

  it('keeps one of the legacy quota phrases in every quota message', () => {
    for (const message of ['English provider error', 'Bạn đã dùng hết số thẻ AI kỳ này.']) {
      expect(captureFailureMessage(protectedFailure('quota', message))).toMatch(/hạn mức|số thẻ|lượt AI/);
    }
  });
});

describe('capture failure reasons the extension understands', () => {
  const extensionFile = (path: string) => readFileSync(new URL(`../../extensions/lingoflash/${path}`, import.meta.url), 'utf8');

  it('are all accepted by the extension and have text in both of its catalogs', () => {
    const accepted = /RESULT_REASONS = new Set\(\[([^\]]*)\]\)/.exec(extensionFile('background-core.js'))?.[1] ?? '';
    for (const reason of CAPTURE_FAILURE_REASONS) {
      expect(accepted, reason).toContain(`'${reason}'`);
      for (const locale of ['en', 'vi']) {
        const catalog = JSON.parse(extensionFile(`_locales/${locale}/messages.json`)) as Record<string, { message: string }>;
        expect(catalog[`captureReason_${reason.replaceAll('-', '_')}`]?.message, `${locale} ${reason}`).toBeTruthy();
      }
    }
  });
});
