import { OperationTimeoutError } from './async';
import { ProtectedFunctionError } from './protectedFunctionsCapability';

/**
 * Why a capture failed, as a bounded code the extension turns into text of its own language.
 * The wire message stays as a fallback; the quota wording in it is still what an extension
 * older than this field detects, so keep 'hạn mức', 'số thẻ' or 'lượt AI' in every quota message.
 */
export const CAPTURE_FAILURE_REASONS = [
  'quota-ai-cards', 'quota-daily', 'quota-service', 'quota',
  'auth', 'permission', 'network', 'configuration', 'timeout', 'failed',
  'deck-missing', 'course-cancelled', 'course-unavailable', 'invalid-selection', 'account-changed', 'not-verified',
] as const;
export type CaptureFailureReason = typeof CAPTURE_FAILURE_REASONS[number];

const QUOTA_REASONS: Record<string, CaptureFailureReason> = {
  'ai-card-quota': 'quota-ai-cards',
  'ai-daily-allowance': 'quota-daily',
  'account-daily-spend': 'quota-daily',
  'service-daily-cap': 'quota-service',
};

/** No reason for a message that carries its own retry guidance, so the extension shows that message. */
export const captureFailureReason = (error: unknown): CaptureFailureReason | undefined => {
  if (error instanceof ProtectedFunctionError) {
    if (error.retryAfterMs !== undefined) return undefined;
    if (error.kind === 'quota') return QUOTA_REASONS[error.reason ?? ''] ?? 'quota';
    if (error.kind === 'authentication') return 'auth';
    if (error.kind === 'permission') return 'permission';
    if (error.kind === 'network') return 'network';
    if (error.kind === 'configuration') return 'configuration';
    return 'failed';
  }
  return error instanceof OperationTimeoutError ? 'timeout' : 'failed';
};

export const captureFailureMessage = (error: unknown): string => {
  if (error instanceof ProtectedFunctionError) {
    if (error.retryAfterMs !== undefined) return error.message;
    if (error.kind === 'quota') return error.message.includes('hạn mức') || error.message.includes('số thẻ') || error.message.includes('lượt AI')
      ? error.message : 'Dịch vụ AI đã hết hạn mức. Từ đã chọn vẫn được giữ lại; hãy thử lại sau.';
    if (error.kind === 'authentication') return 'Bạn cần đăng nhập Google để tạo thẻ. Từ đã chọn vẫn được giữ lại; đăng nhập rồi thử lại.';
    if (error.kind === 'permission') return 'Quyền truy cập AI bị từ chối. Từ đã chọn vẫn được giữ lại; hãy đăng nhập lại rồi thử.';
    if (error.kind === 'network') return 'Kết nối hoặc dịch vụ AI bị gián đoạn. Từ đã chọn vẫn được giữ lại; hãy thử lại.';
    if (error.kind === 'configuration') return 'Dịch vụ AI chưa sẵn sàng. Từ đã chọn vẫn được giữ lại; hãy thử lại sau.';
    return 'Dịch vụ AI chưa tạo được thẻ. Từ đã chọn vẫn được giữ lại; hãy thử lại hoặc liên hệ hỗ trợ.';
  }
  if (error instanceof OperationTimeoutError) return 'Dịch vụ AI phản hồi quá lâu. Từ đã chọn vẫn được giữ lại; hãy thử lại.';
  return 'Chưa tạo hoặc lưu được thẻ. Từ đã chọn vẫn được giữ lại; hãy thử lại.';
};
