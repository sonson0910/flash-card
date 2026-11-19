import { ACCEPTED_CONTENT_TYPES, type FileLimits, type FileRejectionReason, type FileSummary, type FileUsage } from './fileModel';
import { FileError, type FilePort, type UploadTransfer } from './filePort';

export type MemoryFinalizeResult =
  | { readonly status: 'ready' | 'partial' }
  | { readonly status: 'rejected'; readonly reason: FileRejectionReason }
  | { readonly status: 'pending' };

export interface MemoryFilePortOptions {
  readonly limits: FileLimits;
  readonly files?: readonly FileSummary[];
  readonly courseIds?: readonly string[];
  /** Replaces the transfer; the default sends everything at once and succeeds. */
  readonly transfer?: (data: Blob, onProgress: (sent: number, total: number) => void) => UploadTransfer;
  /** Decides what the service makes of a finished upload; the default stores it as ready. */
  readonly finalize?: (file: FileSummary, data: Blob) => MemoryFinalizeResult;
  readonly listError?: () => FileError | null;
  readonly now?: () => Date;
}

/**
 * A file service held in memory with the same rules as the real one: reservations count against
 * the allowance, the stored size replaces the declared size, and deleting gives the bytes back.
 * It has no data of its own; tests and fixture pages pass the files they need.
 */
export const createMemoryFilePort = (options: MemoryFilePortOptions): FilePort & {
  /** Settles pending uploads the way the finalize trigger would. */
  settle(fileId: string, result: Exclude<MemoryFinalizeResult, { status: 'pending' }>): void;
} => {
  const now = options.now ?? (() => new Date());
  const files = new Map<string, FileSummary>((options.files ?? []).map(file => [file.id, file]));
  const blobs = new Map<string, Blob>();
  let sequence = 0;

  const usage = (): FileUsage => {
    let usedBytes = 0;
    let reservedBytes = 0;
    let fileCount = 0;
    for (const file of files.values()) {
      if (file.status === 'ready' || file.status === 'partial') {
        usedBytes += file.bytes ?? 0;
        fileCount += 1;
      } else if (file.status === 'uploading') {
        reservedBytes += file.declaredBytes;
      }
    }
    return { usedBytes, reservedBytes, fileCount };
  };

  const settle = (fileId: string, result: Exclude<MemoryFinalizeResult, { status: 'pending' }>) => {
    const file = files.get(fileId);
    const data = blobs.get(fileId);
    if (!file || file.status !== 'uploading' || !data) return;
    const stamp = now().toISOString();
    if (result.status === 'rejected') {
      files.set(fileId, { ...file, status: 'rejected', rejectionReason: result.reason, bytes: data.size, updatedAt: stamp });
      return;
    }
    const current = usage();
    if (current.usedBytes + data.size > options.limits.limitBytes) {
      files.set(fileId, { ...file, status: 'rejected', rejectionReason: 'quota', bytes: data.size, updatedAt: stamp });
      return;
    }
    files.set(fileId, {
      ...file, status: result.status, verification: result.status === 'ready' ? 'complete' : 'partial',
      bytes: data.size, updatedAt: stamp,
    });
  };

  return {
    settle,
    async list() {
      const error = options.listError?.();
      if (error) throw error;
      const visible = [...files.values()]
        .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
      return { files: visible, usage: usage(), limits: options.limits };
    },
    async prepare(input) {
      const kind = ACCEPTED_CONTENT_TYPES[input.contentType];
      if (!kind) throw new FileError('type');
      if (input.bytes > options.limits.maxFileBytes) throw new FileError('size');
      const current = usage();
      if (current.usedBytes + current.reservedBytes + input.bytes > options.limits.limitBytes) throw new FileError('quota');
      if (input.courseId && options.courseIds && !options.courseIds.includes(input.courseId)) throw new FileError('not-found');
      sequence += 1;
      const fileId = `memory-file-${String(sequence).padStart(8, '0')}`;
      const stamp = now().toISOString();
      files.set(fileId, {
        id: fileId, name: input.name, kind, contentType: input.contentType, purpose: input.purpose,
        courseId: input.courseId, status: 'uploading', verification: 'pending', bytes: null, declaredBytes: input.bytes,
        rejectionReason: null, createdAt: stamp, updatedAt: stamp,
      });
      return { fileId, path: `memory/${fileId}`, maxFileBytes: options.limits.maxFileBytes, expiresAt: stamp };
    },
    upload(prepared, data, _contentType, onProgress) {
      const transfer = options.transfer?.(data, onProgress) ?? {
        done: Promise.resolve().then(() => onProgress(data.size, data.size)),
        cancel() {},
      };
      return {
        cancel: () => transfer.cancel(),
        done: transfer.done.then(() => {
          blobs.set(prepared.fileId, data);
          const file = files.get(prepared.fileId);
          if (!file) return;
          const result = options.finalize?.(file, data) ?? { status: 'ready' };
          if (result.status !== 'pending') settle(prepared.fileId, result);
        }),
      };
    },
    async attach(fileId, courseId) {
      const file = files.get(fileId);
      if (!file || file.status === 'rejected') throw new FileError('not-found');
      if (file.status === 'uploading') throw new FileError('rejected');
      if (courseId && options.courseIds && !options.courseIds.includes(courseId)) throw new FileError('not-found');
      const next = { ...file, courseId, updatedAt: now().toISOString() };
      files.set(fileId, next);
      return next;
    },
    async remove(fileId) {
      if (!files.delete(fileId)) throw new FileError('not-found');
      blobs.delete(fileId);
      return usage();
    },
    async downloadUrl(fileId) {
      const data = blobs.get(fileId);
      if (!data || typeof URL.createObjectURL !== 'function') throw new FileError('not-found');
      return URL.createObjectURL(data);
    },
  };
};
