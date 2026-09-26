import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { app, protectedFunctionsCapability } from '../../lib/firebase';
import { ProtectedFunctionError, runProtectedFunction } from '../../lib/protectedFunctionsCapability';

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
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.cardId)) {
    throw new Error(i18n._(msg({ id: 'cardReport.validation.card-id', message: 'The card to report is invalid.' })));
  }
  if (!CARD_REPORT_REASONS.includes(input.reason)) {
    throw new Error(i18n._(msg({ id: 'cardReport.validation.reason', message: 'Please choose a reason for the report.' })));
  }
  const note = input.note?.trim() ?? '';
  if (note.length > 280) throw new Error(i18n._(msg({ id: 'cardReport.validation.note-length', message: 'The note can be at most 280 characters.' })));

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
    throw new Error(i18n._(msg({ id: 'cardReport.error.submit-failed', message: "Couldn't send the card report right now. Please try again." })));
  }
}

export function reportCardFailureMessage(error: unknown): string {
  if (error instanceof ProtectedFunctionError) {
    if (error.code === 'not-found') return i18n._(msg({ id: 'cardReport.error.not-found', message: 'Card not found to report. It may have been deleted.' }));
    if (error.kind === 'authentication') return i18n._(msg({ id: 'cardReport.error.authentication', message: 'You need to sign in to report a card. Please sign in and try again.' }));
    if (error.kind === 'permission') return i18n._(msg({ id: 'cardReport.error.permission', message: "You don't have permission to report this card. Please sign in again and try." }));
    if (error.kind === 'quota') return i18n._(msg({ id: 'cardReport.error.quota', message: "You've reported too many times in a short period. Please try again later." }));
    if (error.kind === 'network') return i18n._(msg({ id: 'cardReport.error.network', message: "Couldn't reach the report server. Please check your connection and try again." }));
    if (error.kind === 'configuration') return i18n._(msg({ id: 'cardReport.error.configuration', message: 'The card reporting service is not ready yet. Please try again later.' }));
    return i18n._(msg({ id: 'cardReport.error.unknown', message: "Couldn't send the report. Please try again or contact support." }));
  }
  if (error instanceof Error && error.message) return error.message;
  return i18n._(msg({ id: 'cardReport.error.fallback', message: "Couldn't send the report. Please check your connection and try again." }));
}
