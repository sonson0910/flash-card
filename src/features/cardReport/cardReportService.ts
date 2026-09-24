import { app, protectedFunctionsCapability } from '../../lib/firebase';
import { runProtectedFunction } from '../../lib/protectedFunctionsCapability';

const REGION = 'asia-southeast1';

export const CARD_REPORT_REASONS = [
  'wrong-meaning',
  'wrong-example',
  'wrong-pronunciation',
  'wrong-image',
  'offensive',
  'other',
] as const;

export type CardReportReason = typeof CARD_REPORT_REASONS[number];

export type CardReportInput = {
  cardId: string;
  reason: CardReportReason;
  note?: string;
};

export async function submitCardReport(input: CardReportInput): Promise<void> {
  const firebaseApp = app;
  if (!firebaseApp) throw new Error('Card reporting is unavailable in this build.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.cardId)) throw new Error('Thẻ cần báo cáo không hợp lệ.');
  if (!CARD_REPORT_REASONS.includes(input.reason)) throw new Error('Vui lòng chọn lý do báo cáo.');
  const note = input.note?.trim() ?? '';
  if (note.length > 280) throw new Error('Ghi chú tối đa 280 ký tự.');

  const response = await runProtectedFunction(protectedFunctionsCapability, 'Card report', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<CardReportInput, { reportId: string; status: 'open' }>(
      getFunctions(firebaseApp, REGION),
      'reportCard',
    );
    return callable({
      cardId: input.cardId,
      reason: input.reason,
      ...(note ? { note } : {}),
    });
  });
  if (typeof response.data?.reportId !== 'string' || response.data.status !== 'open') {
    throw new Error('Không thể gửi báo cáo thẻ lúc này. Vui lòng thử lại.');
  }
}
