import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { captureFailureReason, type CaptureFailureReason } from '../../lib/captureFailureMessage';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';

/**
 * What the learner reads in the app for each reason a capture failed. The browser extension
 * reads the same reasons from its own catalogs, so a new reason has to be named here too:
 * the record below stops compiling until it is.
 */
export const CAPTURE_FAILURE_COPY = {
  'quota-ai-cards': msg({ id: 'library.capture-failure.quota-ai-cards', message: 'You have used all your AI cards for this period. See the Pro plan or wait for the next period; reviewing and adding cards by hand still work.' }),
  'quota-daily': msg({ id: 'library.capture-failure.quota-daily', message: 'You have used up today\'s AI turns. Try again after 00:00 (Vietnam time).' }),
  'quota-service': msg({ id: 'library.capture-failure.quota-service', message: 'AI is paused because today\'s shared limit is used up. Try again after 00:00 (Vietnam time).' }),
  quota: msg({ id: 'library.capture-failure.quota', message: 'The AI service has hit its quota. The selected word is kept; try again later.' }),
  'in-flight': msg({ id: 'library.capture-failure.in-flight', message: 'The AI card for this word is still being created. The selected word is kept; try again in a few seconds.' }),
  auth: msg({ id: 'library.capture-failure.auth', message: 'Sign in with Google to create cards. The selected word is kept; sign in and try again.' }),
  permission: msg({ id: 'library.capture-failure.permission', message: 'AI access was denied. The selected word is kept; sign in again and retry.' }),
  network: msg({ id: 'library.capture-failure.network', message: 'The connection or the AI service was interrupted. The selected word is kept; try again.' }),
  configuration: msg({ id: 'library.capture-failure.configuration', message: 'The AI service is not ready. The selected word is kept; try again later.' }),
  timeout: msg({ id: 'library.capture-failure.timeout', message: 'The AI service took too long to respond. The selected word is kept; try again.' }),
  failed: msg({ id: 'library.capture-failure.failed', message: 'The card could not be created or saved. The selected word is kept; try again.' }),
  'deck-missing': msg({ id: 'library.capture-failure.deck-missing', message: 'The selected deck no longer exists. Choose a deck and try again.' }),
  'course-cancelled': msg({ id: 'library.capture-failure.course-cancelled', message: 'Import cancelled: switch to a matching course, then select the word again.' }),
  'course-unavailable': msg({ id: 'library.capture-failure.course-unavailable', message: 'The matching course could not be prepared. The word was not saved.' }),
  'invalid-selection': msg({ id: 'library.capture-failure.invalid-selection', message: 'Select a word or a short phrase of at most 80 characters in your course\'s language.' }),
  'account-changed': msg({ id: 'library.capture-failure.account-changed', message: 'Import cancelled because the signed-in account changed. Select the word again.' }),
  'not-verified': msg({ id: 'library.capture-failure.not-verified', message: 'This import could not be verified securely. Select the word again.' }),
} as const satisfies Record<CaptureFailureReason, MessageDescriptor>;

export const captureFailureReasonCopy = (reason: CaptureFailureReason): string => {
  const descriptor: MessageDescriptor = CAPTURE_FAILURE_COPY[reason];
  return i18n.locale ? i18n._(descriptor) : descriptor.message ?? descriptor.id;
};

/**
 * The failure of a capture in the learner's language, chosen by the reason code of the error.
 * A capture can fail while another screen is open, so the catalog that holds the text is loaded first.
 */
export const captureFailureCopy = async (error: unknown, reason = captureFailureReason(error)): Promise<string> => {
  await loadCatalog(getActiveUiLocale(), 'library').catch(() => undefined);
  return captureFailureReasonCopy(reason);
};
