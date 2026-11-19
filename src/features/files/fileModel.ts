/**
 * Client view of the learner file service. The service owns every number here: file sizes come
 * from the stored object, usage and limits come from the account's plan configuration.
 */

export type FileKind = 'pdf' | 'epub' | 'image';
export type FilePurpose = 'source' | 'card-image';
export type FileStatus = 'uploading' | 'ready' | 'partial' | 'rejected';
export type FileVerification = 'pending' | 'complete' | 'partial' | 'unavailable' | 'failed';
export type FileRejectionReason = 'type' | 'size' | 'quota' | 'signature' | 'expired';

export interface FileSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly contentType: string;
  readonly purpose: FilePurpose;
  readonly courseId: string | null;
  readonly status: FileStatus;
  readonly verification: FileVerification;
  readonly bytes: number | null;
  readonly declaredBytes: number;
  readonly rejectionReason: FileRejectionReason | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface FileUsage {
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly fileCount: number;
}

export interface FileLimits {
  readonly tier: 'free' | 'pro';
  readonly limitBytes: number;
  readonly maxFileBytes: number;
}

export interface FileListing {
  readonly files: readonly FileSummary[];
  readonly usage: FileUsage;
  readonly limits: FileLimits;
}

export interface PreparedUpload {
  readonly fileId: string;
  readonly path: string;
  readonly maxFileBytes: number;
  readonly expiresAt: string;
}

/** Content types the service accepts; the file chooser offers the same list. */
export const ACCEPTED_CONTENT_TYPES: Readonly<Record<string, FileKind>> = Object.freeze({
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'image/webp': 'image',
  'image/png': 'image',
  'image/jpeg': 'image',
});

export const FILE_INPUT_ACCEPT = '.pdf,.epub,image/*';

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * The type the browser reports, or the one implied by the extension when the browser reports
 * none (EPUB often arrives without a type). Images in other formats are re-encoded before upload.
 */
export const contentTypeOf = (file: { readonly name: string; readonly type: string }): string => {
  const reported = file.type.trim().toLowerCase();
  if (reported) return reported;
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? '';
};

/** The kind a chosen file would become, or null when the service would refuse it. */
export const kindOfSelection = (file: { readonly name: string; readonly type: string }): FileKind | null => {
  const type = contentTypeOf(file);
  if (ACCEPTED_CONTENT_TYPES[type]) return ACCEPTED_CONTENT_TYPES[type];
  // Other image formats (HEIC, GIF, BMP) are decoded and re-encoded in the browser before upload.
  return type.startsWith('image/') && type !== 'image/svg+xml' ? 'image' : null;
};

export type ClientCheck = 'type' | 'size' | 'plan';

export type ClientCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly check: ClientCheck };

/**
 * Fast feedback before any byte leaves the device. `plan` fails only when the plan limits could
 * not be read; the service still decides type, size, allowance and ownership.
 */
export const checkSelection = (
  file: { readonly name: string; readonly type: string; readonly size: number },
  limits: FileLimits | null,
): ClientCheckResult => {
  const kind = kindOfSelection(file);
  if (!kind) return { ok: false, check: 'type' };
  if (file.size <= 0) return { ok: false, check: 'size' };
  // Images are resized before upload, so only their encoded size is compared with the plan.
  if (kind !== 'image' && limits && file.size > limits.maxFileBytes) return { ok: false, check: 'size' };
  if (!limits) return { ok: false, check: 'plan' };
  return { ok: true };
};

export const usageFraction = (usage: FileUsage, limits: FileLimits): number => {
  if (limits.limitBytes <= 0) return 0;
  return Math.min(1, Math.max(0, usage.usedBytes / limits.limitBytes));
};

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Binary byte sizes in the learner's number format, for example "1.2 MB". */
export const formatBytes = (bytes: number, locale: string): string => {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
};
