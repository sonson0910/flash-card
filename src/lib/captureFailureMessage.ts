import { OperationTimeoutError } from './async';
import { ProtectedFunctionError } from './protectedFunctionsCapability';

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
