import type { FileListing, FilePurpose, FileSummary, FileUsage, PreparedUpload } from './fileModel';

export interface PrepareUploadInput {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly purpose: FilePurpose;
  readonly courseId: string | null;
  /**
   * A file ID chosen on the device. Asking again with the same ID returns the reservation the first
   * request made, so a retry after a lost answer does not reserve the bytes twice.
   */
  readonly fileId?: string;
}

/** One running browser upload. `cancel` aborts the transfer; `done` settles once it ends. */
export interface UploadTransfer {
  readonly done: Promise<void>;
  cancel(): void;
}

/**
 * Everything the files feature needs from the outside world. The Firebase adapter talks to the
 * callables and Cloud Storage; the in-memory adapter backs unit tests and fixture pages.
 */
export interface FilePort {
  /** One page of files, newest first; `cursor` is a previous page's `nextCursor`. */
  list(cursor?: string): Promise<FileListing>;
  prepare(input: PrepareUploadInput): Promise<PreparedUpload>;
  upload(prepared: PreparedUpload, data: Blob, contentType: string, onProgress: (sentBytes: number, totalBytes: number) => void): UploadTransfer;
  attach(fileId: string, courseId: string | null): Promise<FileSummary>;
  remove(fileId: string): Promise<FileUsage>;
  /** A download URL for the stored object, readable only by its owner's session or link holders. */
  downloadUrl(fileId: string): Promise<string>;
}

export type FileErrorKind =
  | 'quota'
  | 'size'
  | 'type'
  | 'canceled'
  | 'network'
  | 'rejected'
  | 'not-found'
  | 'not-ready'
  | 'rate-limited'
  | 'profile-required'
  | 'unavailable';

/** A failure the UI can explain; `cause` keeps the original error for diagnostics. */
export class FileError extends Error {
  constructor(readonly kind: FileErrorKind, readonly cause?: unknown) {
    super(kind);
    this.name = 'FileError';
  }
}

const codeOf = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return '';
};

const reasonOf = (error: unknown): string => {
  const details = error && typeof error === 'object' ? (error as { details?: unknown }).details : undefined;
  if (details && typeof details === 'object' && typeof (details as { reason?: unknown }).reason === 'string') {
    return (details as { reason: string }).reason;
  }
  return '';
};

/** Maps Functions and Storage SDK errors onto the states the upload screens show. */
export const toFileError = (error: unknown): FileError => {
  if (error instanceof FileError) return error;
  const code = codeOf(error).replace(/^functions\//, '');
  const reason = reasonOf(error);
  if (reason === 'storage-quota') return new FileError('quota', error);
  if (reason === 'file-too-large') return new FileError('size', error);
  if (reason === 'file-type') return new FileError('type', error);
  if (reason === 'account-profile-required') return new FileError('profile-required', error);
  if (reason === 'file-not-found' || reason === 'course-not-found') return new FileError('not-found', error);
  if (reason === 'file-not-ready') return new FileError('not-ready', error);
  switch (code) {
    case 'storage/canceled':
      return new FileError('canceled', error);
    case 'storage/unauthorized':
    case 'storage/invalid-checksum':
    case 'invalid-argument':
    case 'permission-denied':
      return new FileError('rejected', error);
    case 'storage/quota-exceeded':
      return new FileError('quota', error);
    case 'storage/object-not-found':
    case 'not-found':
      return new FileError('not-found', error);
    case 'resource-exhausted':
      return new FileError('rate-limited', error);
    case 'storage/retry-limit-exceeded':
    case 'storage/unknown':
    case 'storage/server-file-wrong-size':
    case 'unavailable':
    case 'deadline-exceeded':
    case 'internal':
      return new FileError('network', error);
    default:
      return new FileError('unavailable', error);
  }
};
