import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { ClientCheck, FileKind, FileStatus } from './fileModel';
import type { FileErrorKind } from './filePort';
import type { UploadPhase } from './uploadSession';

/** Translates a descriptor with values; the message travels with it so tests need no catalog. */
export const formatMessage = (
  translate: (descriptor: MessageDescriptor) => string,
  descriptor: MessageDescriptor,
  values: Record<string, unknown>,
): string => translate({ ...descriptor, values });

/** Short labels for a stored file's kind, as the badges and meta lines show them. */
export const KIND_LABELS: Record<FileKind, MessageDescriptor> = {
  pdf: msg({ id: 'files.kind.pdf', message: 'PDF' }),
  epub: msg({ id: 'files.kind.epub', message: 'EPUB' }),
  image: msg({ id: 'files.kind.image', message: 'Image' }),
};

export const STATUS_LABELS: Record<FileStatus, MessageDescriptor> = {
  uploading: msg({ id: 'files.status.uploading', message: 'Uploading' }),
  ready: msg({ id: 'files.status.ready', message: 'Ready' }),
  partial: msg({ id: 'files.status.partial', message: 'Partial' }),
  rejected: msg({ id: 'files.status.rejected', message: 'Rejected' }),
};

/** The chip beside the page heading names the upload's current step. */
export const PHASE_CAPTIONS: Record<UploadPhase, MessageDescriptor> = {
  select: msg({ id: 'files.phase.select', message: 'Select' }),
  validating: msg({ id: 'files.phase.validating', message: 'Checking' }),
  rejected: msg({ id: 'files.phase.rejected', message: 'Needs attention' }),
  uploading: msg({ id: 'files.phase.uploading', message: 'Uploading' }),
  canceled: msg({ id: 'files.phase.canceled', message: 'Canceled' }),
  retry: msg({ id: 'files.phase.retry', message: 'Retry' }),
  'upload-incomplete': msg({ id: 'files.phase.upload-incomplete', message: 'Upload incomplete' }),
  'upload-rejected': msg({ id: 'files.phase.upload-rejected', message: 'Upload rejected' }),
  'quota-exceeded': msg({ id: 'files.phase.quota-exceeded', message: 'Storage full' }),
  processing: msg({ id: 'files.phase.processing', message: 'Processing' }),
  results: msg({ id: 'files.phase.results', message: 'Ready to attach' }),
  partial: msg({ id: 'files.phase.partial', message: 'Partial result' }),
};

export const CHECK_LABELS: Record<ClientCheck, MessageDescriptor> = {
  type: msg({ id: 'files.check.type', message: 'Type' }),
  size: msg({ id: 'files.check.size', message: 'Size' }),
  plan: msg({ id: 'files.check.plan', message: 'Plan' }),
};

export const CHECK_CHIPS: Record<ClientCheck, MessageDescriptor> = {
  type: msg({ id: 'files.check.type-chip', message: 'Type check' }),
  size: msg({ id: 'files.check.size-chip', message: 'Size check' }),
  plan: msg({ id: 'files.check.plan-chip', message: 'Plan check' }),
};

export const CHECK_PENDING: Record<ClientCheck, { heading: MessageDescriptor; detail: MessageDescriptor; row: MessageDescriptor }> = {
  type: {
    heading: msg({ id: 'files.check.type-pending', message: 'Checking file type' }),
    detail: msg({ id: 'files.check.type-pending-detail', message: 'PDF, EPUB, and images can be uploaded.' }),
    row: msg({ id: 'files.check.type-row', message: 'Checking type' }),
  },
  size: {
    heading: msg({ id: 'files.check.size-pending', message: 'Checking file size' }),
    detail: msg({ id: 'files.check.size-pending-detail', message: 'The file size is compared with your plan before sending.' }),
    row: msg({ id: 'files.check.size-row', message: 'Checking size' }),
  },
  plan: {
    heading: msg({ id: 'files.check.plan-pending', message: 'Checking with the service' }),
    detail: msg({ id: 'files.check.plan-pending-detail', message: 'Your plan and storage allowance are confirmed by the service.' }),
    row: msg({ id: 'files.check.plan-row', message: 'Checking plan' }),
  },
};

export const CHECK_FAILED: Record<ClientCheck, { heading: MessageDescriptor; detail: MessageDescriptor; action: MessageDescriptor }> = {
  type: {
    heading: msg({ id: 'files.check.type-failed', message: 'Type not supported' }),
    detail: msg({ id: 'files.check.type-failed-detail', message: 'Choose a PDF, EPUB, PNG, JPEG, or WebP file.' }),
    action: msg({ id: 'files.check.type-action', message: 'Choose another' }),
  },
  size: {
    heading: msg({ id: 'files.check.size-failed', message: 'File is too large' }),
    detail: msg({ id: 'files.check.size-failed-detail', message: 'Your plan accepts files up to {limit}.' }),
    action: msg({ id: 'files.check.size-action', message: 'Choose a smaller file' }),
  },
  plan: {
    heading: msg({ id: 'files.check.plan-failed', message: 'The service needs to confirm your plan' }),
    detail: msg({ id: 'files.check.plan-failed-detail', message: 'Your storage allowance could not be loaded here, so the service will decide.' }),
    action: msg({ id: 'files.check.plan-action', message: 'Continue to service' }),
  },
};

/** Why the service refused a finished or started upload. */
export const REJECTION_DETAILS: Partial<Record<string, MessageDescriptor>> = {
  signature: msg({ id: 'files.rejected.signature', message: 'The file’s contents do not match its type. Choose another file or review My files.' }),
  type: msg({ id: 'files.rejected.type', message: 'This file type is not accepted. Choose another file or review My files.' }),
  size: msg({ id: 'files.rejected.size', message: 'The file is larger than your plan accepts. Choose a smaller file.' }),
  expired: msg({ id: 'files.rejected.expired', message: 'The upload took too long to finish. Choose the file again to retry.' }),
  'rate-limited': msg({ id: 'files.rejected.rate-limited', message: 'Too many uploads in a short time. Wait a moment, then try again.' }),
  'profile-required': msg({ id: 'files.rejected.profile-required', message: 'Finish setting up your profile before uploading files.' }),
};

export const REJECTION_FALLBACK = msg({ id: 'files.rejected.default', message: 'The service did not accept this upload. Choose another file or review My files.' });

export const FILE_ERROR_MESSAGES: Record<FileErrorKind, MessageDescriptor> = {
  quota: msg({ id: 'files.error.quota', message: 'Your storage is full. Delete files you no longer need, then try again.' }),
  size: msg({ id: 'files.error.size', message: 'This image is larger than your plan accepts.' }),
  type: msg({ id: 'files.error.type', message: 'Choose a PNG, JPEG, or WebP image.' }),
  canceled: msg({ id: 'files.error.canceled', message: 'The upload was canceled.' }),
  network: msg({ id: 'files.error.network', message: 'The upload did not finish. Check your connection and try again.' }),
  rejected: msg({ id: 'files.error.rejected', message: 'The service did not accept this image.' }),
  'not-found': msg({ id: 'files.error.not-found', message: 'That file is no longer available.' }),
  'not-ready': msg({ id: 'files.error.not-ready', message: 'The file is still being checked. Try again in a moment.' }),
  'rate-limited': msg({ id: 'files.error.rate-limited', message: 'Too many uploads in a short time. Wait a moment, then try again.' }),
  'profile-required': msg({ id: 'files.error.profile-required', message: 'Finish setting up your profile before uploading files.' }),
  unavailable: msg({ id: 'files.error.unavailable', message: 'Uploads are unavailable right now. Try again later.' }),
};

/** What the learner reads when attaching a file to a course fails: the cases they can act on, else a generic retry. */
export const attachFailureCopy = (kind: FileErrorKind): MessageDescriptor => (
  kind === 'not-ready' || kind === 'not-found'
    ? FILE_ERROR_MESSAGES[kind]
    : msg({ id: 'files.result.attach-failed', message: 'The file could not be attached. Try again.' })
);
